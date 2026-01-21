/**
 * JSON Configuration Loader
 *
 * Loads application and function pool configurations from JSON files or REST endpoints.
 * The JSON format is directly compatible with TreeBuilder - no transformation needed.
 *
 * JSON Reference Format:
 * - Sync reference:       { "ref": "functionName" }
 * - Async reference:      { "ref": "functionName", "async": true, "queueName": "QUEUE.NAME" }
 * - Topic publish:        { "topicName": "eventName", "topicPublish": true }
 */

import { readFile, readdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load JSON from a file path
 * @param {string} filePath - Path to the JSON file
 * @returns {Promise<object>} Parsed JSON object
 */
async function loadFromFile(filePath) {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content);
}

/**
 * Load JSON from a URL (REST endpoint)
 * @param {string} url - URL to fetch JSON from
 * @param {object} options - Fetch options (headers, etc.)
 * @returns {Promise<object>} Parsed JSON object
 */
async function loadFromUrl(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            ...options.headers
        },
        ...options
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch from ${url}: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

/**
 * Load JSON from either a file path or URL
 * @param {string} source - File path or URL
 * @param {object} options - Fetch options for URL sources
 * @returns {Promise<object>} Parsed JSON object
 */
async function loadJson(source, options = {}) {
    if (source.startsWith('http://') || source.startsWith('https://')) {
        return loadFromUrl(source, options);
    }
    return loadFromFile(source);
}

/**
 * Load a single application configuration by name from a directory
 * @param {string} appName - Application name (e.g., "nims-wt-pend-process-app")
 * @param {string} appsDir - Directory containing individual app JSON files
 * @returns {Promise<object>} Application configuration object
 */
async function loadApp(appName, appsDir) {
    const filePath = join(appsDir, `${appName}.json`);
    return loadFromFile(filePath);
}

/**
 * Load a single application configuration from a URL
 * @param {string} url - URL to fetch the app config from
 * @param {object} options - Fetch options (headers, etc.)
 * @returns {Promise<object>} Application configuration object
 */
async function loadAppFromUrl(url, options = {}) {
    return loadFromUrl(url, options);
}

/**
 * Load function pool configuration
 * @param {string} source - File path or URL to functionPool.json
 * @param {object} options - Fetch options for URL sources
 * @returns {Promise<object>} Function pool object
 */
async function loadFunctionPool(source, options = {}) {
    return loadJson(source, options);
}

/**
 * Load function pool from the default config directory
 * @param {string} configDir - Config directory path
 * @returns {Promise<object>} Function pool object
 */
async function loadFunctionPoolFromDirectory(configDir) {
    return loadFromFile(join(configDir, 'functionPool.json'));
}

/**
 * List all available app names in a directory
 * @param {string} appsDir - Directory containing app JSON files
 * @returns {Promise<string[]>} Array of app names (without .json extension)
 */
async function listAvailableApps(appsDir) {
    const files = await readdir(appsDir);
    return files
        .filter(f => f.endsWith('.json'))
        .map(f => basename(f, '.json'));
}

/**
 * Validate that an app configuration has the expected structure
 * @param {object} app - App configuration to validate
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
function validateApp(app) {
    if (!app || typeof app !== 'object') {
        throw new Error('Invalid app config: must be an object');
    }
    if (!app.name) {
        throw new Error('Invalid app config: missing required "name" property');
    }
    if (!app.type) {
        throw new Error(`Invalid app "${app.name}": missing required "type" property`);
    }
    return true;
}

/**
 * Validate that a function pool configuration has the expected structure
 * @param {object} pool - Function pool configuration to validate
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
function validateFunctionPool(pool) {
    if (!pool || typeof pool !== 'object') {
        throw new Error('Invalid function pool: must be an object');
    }
    return true;
}

/**
 * Get the default config directory path
 * @returns {string}
 */
function getDefaultConfigDir() {
    return join(__dirname, 'config');
}

/**
 * Get the default apps directory path
 * @returns {string}
 */
function getDefaultAppsDir() {
    return join(__dirname, 'config', 'apps');
}

export {
    loadJson,
    loadFromFile,
    loadFromUrl,
    loadApp,
    loadAppFromUrl,
    loadFunctionPool,
    loadFunctionPoolFromDirectory,
    listAvailableApps,
    validateApp,
    validateFunctionPool,
    getDefaultConfigDir,
    getDefaultAppsDir
};
