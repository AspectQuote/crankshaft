import { readdirSync, existsSync, mkdirSync } from 'fs';
import { join as pathJoin } from 'path';

import { Filter } from 'electron';
import { readFileSync } from 'original-fs';

// TODO: conditional import (?)
import { URLPattern } from 'urlpattern-polyfill';

const TARGET_GAME_DOMAIN = 'krunker.io';

/// <reference path="global.d.ts" />

const lunarBaseSoundPairs = Object.entries({
	'weapon_1_13.mp3': 'weapon_1.mp3', // Sniper Rifle
	'weapon_2_11.mp3': 'weapon_2.mp3', // Assault Rifle
	'weapon_3_6.mp3': 'weapon_3.mp3', // Pistol
	'weapon_4_8.mp3': 'weapon_4.mp3', // Submachine Gun
	'weapon_5_3.mp3': 'weapon_5.mp3', // Revolver
	'weapon_6_3.mp3': 'weapon_6.mp3', // Shotgun
	'weapon_7_7.mp3': 'weapon_7.mp3', // Light Machine Gun
	'weapon_8_3.mp3': 'weapon_8.mp3', // Semi Auto
	'weapon_9_2.mp3': 'weapon_9.mp3', // Rocket Launcher
	'weapon_10_4.mp3': 'weapon_10.mp3', // Akimbo Uzis
	'weapon_11_4.mp3': 'weapon_11.mp3', // Desert Eagle
	'weapon_12_2.mp3': 'weapon_12.mp3', // Alien Blaster
	'weapon_14_3.mp3': 'weapon_14.mp3', // Crossbow
	'weapon_15_4.mp3': 'weapon_15.mp3', // FAMAS
	'weapon_16_2.mp3': 'weapon_16.mp3', // Sawed Off
	'weapon_17_4.mp3': 'weapon_17.mp3', // Auto Pistol
	'weapon_19_1.mp3': 'weapon_19.mp3', // Blaster
	'weapon_22_2.mp3': 'weapon_22.mp3' // Tehchy-9
})

/**
 * RequestHandler
 * @class RequestHandler
 */
export default class {

	private browserWindow: Electron.BrowserWindow;

	private swapperEnabled: boolean;

	private autoLunarSwapper: boolean;

	private blockerEnabled: boolean;

	private customFiltersEnabled: boolean;

	private filter: Filter = { urls: [] };

	private swapUrls: string[] = [];

	private started = false;

	private swapDir: string;

	private defaultFilters: string[];

	private customFilters: string[] = [];

	/**
	 * Set the target window.
	 *
	 * @param browserWindow - The target window.
	 */
	// FIXME: better way to enable/disable?
	public constructor(browserWindow: Electron.BrowserWindow, swapDir: string, swapperEnabled: boolean, autoLunarSwapper: boolean, blockerEnabled: boolean, customFiltersEnabled: boolean, defaultFiltersStr: string, customFiltersPath: string) {
		this.browserWindow = browserWindow;
		this.swapDir = swapDir;
		this.swapperEnabled = swapperEnabled;
		this.autoLunarSwapper = autoLunarSwapper;
		this.blockerEnabled = blockerEnabled;
		this.customFiltersEnabled = customFiltersEnabled;

		this.defaultFilters = defaultFiltersStr.split(/\r?\n/u);
		this.customFilters = readFileSync(customFiltersPath, { encoding: 'utf-8' }).toString()
			.split(/\r?\n/u)
			.filter(filter => filter[0] !== '#');
	}

	/** Initialize the request handler for the target window.*/
	public start(): void {
		if (this.started) return;

		// If the target directory doesn't exist, create it.
		if (!existsSync(this.swapDir)) mkdirSync(this.swapDir, { recursive: true });

		if (this.swapperEnabled) {
			this.recursiveSwap('');
			this.filter.urls.push(...this.swapUrls);
		}

		if (this.autoLunarSwapper) {
			const lunarURLs = lunarBaseSoundPairs.map(([originalPath, desiredPath]) => [`*://*.${TARGET_GAME_DOMAIN}/sound/${originalPath}?*`, `*://*.${TARGET_GAME_DOMAIN}/sound/${originalPath}`]).flat(1);
			this.filter.urls.push(...lunarURLs);
		}

		if (this.blockerEnabled) this.filter.urls.push(...this.defaultFilters);

		if (this.customFiltersEnabled) this.filter.urls.push(...this.customFilters.filter(i => i !== ''));

		this.browserWindow.webContents.session.webRequest.onBeforeRequest(this.filter, (details, callback) => {
			let redirectOverride = '';
			if (this.autoLunarSwapper) {
				const lunarIndex = lunarBaseSoundPairs.findIndex(([originalPath, desiredPath]) => new URLPattern(`*://*.${TARGET_GAME_DOMAIN}/sound/${originalPath}?*`).test(details.url) || new URLPattern(`*://*.${TARGET_GAME_DOMAIN}/sound/${originalPath}`).test(details.url));
				if (lunarIndex !== -1) {
					const resourcePair = lunarBaseSoundPairs[lunarIndex];
					redirectOverride = details.url.replace(resourcePair[0], resourcePair[1]);
				}
			}
			if (this.swapperEnabled) {
				const swapResource = this.swapUrls.some(pat => new URLPattern(pat).test(details.url));
				if (swapResource) {
					const path = (redirectOverride.length > 0) ? new URL(redirectOverride).pathname : new URL(details.url).pathname;
					const resultPath = path.startsWith('/assets/') ? pathJoin(this.swapDir, path.substring(7)) : pathJoin(this.swapDir, path);
					// Redirect to the local resource.
					redirectOverride = `krunker-resource-swapper:/${resultPath}`;
				}
			}
			if (redirectOverride.length > 0) {
				// console.log(`Redirect Override: \n${redirectOverride}`);
				return callback({ redirectURL: redirectOverride });
			}
			if (this.blockerEnabled || this.customFiltersEnabled) {
				const block = this.filter.urls.some(pat => new URLPattern(pat).test(details.url));
				if (block) return callback({ cancel: true });
			}
			return callback({ });
		});


		// Fix CORS problem with browserfps.com.
		this.browserWindow.webContents.session.webRequest.onHeadersReceived(({ responseHeaders }, callback) => {
			for (const key in responseHeaders) {
				const lowercase = key.toLowerCase();

				// If the credentials mode is 'include', callback normally or the request will error with CORS.
				if (lowercase === 'access-control-allow-credentials' && responseHeaders[key][0] === 'true') return callback(responseHeaders);

				// Response headers may have varying letter casing, so we need to check in lowercase.
				if (lowercase === 'access-control-allow-origin') {
					delete responseHeaders[key];
					break;
				}
			}

			return callback({
				responseHeaders: {
					...responseHeaders,
					'access-control-allow-origin': ['*']
				}
			});
		});

		this.started = true;
	}

	/**
	 * Generate a list of url match patterns for all resources to swap (recursive)
	 *
	 * @param prefix - The target directory to swap.
	 */
	private recursiveSwap(prefix: string): void {
		try {
			for (const dirent of readdirSync(pathJoin(this.swapDir, prefix), { withFileTypes: true })) {
				const name = `${prefix}/${dirent.name}`;

				// If the file is a directory, swap it recursively.
				if (dirent.isDirectory()) {
					this.recursiveSwap(name);
				} else {
					// browserfps.com has the server name as the subdomain instead of 'assets', so we must take that into account.
					const tests = [
						`*://*.${TARGET_GAME_DOMAIN}${name}`,
						`*://*.${TARGET_GAME_DOMAIN}${name}?*`,
						`*://*.${TARGET_GAME_DOMAIN}/assets${name}`,
						`*://*.${TARGET_GAME_DOMAIN}/assets${name}?*`
					];
					this.swapUrls.push(...(/^\/(?:models|textures|sound|scares|videos)(?:$|\/)/u.test(name)
						? tests
						: [
							...tests,
							`*://comp.${TARGET_GAME_DOMAIN}${name}?*`,
							`*://comp.${TARGET_GAME_DOMAIN}/assets/${name}?*`
						]
					));
				}
				if (name === "/css/main_custom.css") {
					this.swapUrls.push(...[
						`https://${TARGET_GAME_DOMAIN}/css/main_custom.css`,
						`https://${TARGET_GAME_DOMAIN}/css/main_custom.css?*`,
					])
				}
			}
		} catch (err) {
			console.error(`Failed to resource-swap with prefix: ${prefix}`);
		}
	}
}
