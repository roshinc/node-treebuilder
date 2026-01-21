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

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
 * Load application pool configuration
 * @param {string} source - File path or URL to appPool.json
 * @param {object} options - Fetch options for URL sources
 * @returns {Promise<object>} Application pool object
 */
async function loadAppPool(source, options = {}) {
    return loadJson(source, options);
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
 * Load both pools from a config directory
 * @param {string} configDir - Directory containing appPool.json and functionPool.json
 * @returns {Promise<{appPool: object, functionPool: object}>}
 */
async function loadPoolsFromDirectory(configDir) {
    const [appPool, functionPool] = await Promise.all([
        loadFromFile(join(configDir, 'appPool.json')),
        loadFromFile(join(configDir, 'functionPool.json'))
    ]);

    return { appPool, functionPool };
}

/**
 * Load pools from REST endpoints
 * @param {string} appPoolUrl - URL for application pool
 * @param {string} functionPoolUrl - URL for function pool
 * @param {object} options - Fetch options
 * @returns {Promise<{appPool: object, functionPool: object}>}
 */
async function loadPoolsFromApi(appPoolUrl, functionPoolUrl, options = {}) {
    const [appPool, functionPool] = await Promise.all([
        loadFromUrl(appPoolUrl, options),
        loadFromUrl(functionPoolUrl, options)
    ]);

    return { appPool, functionPool };
}

/**
 * Validate that a pool configuration has the expected structure
 * @param {object} pool - Pool configuration to validate
 * @param {string} poolType - 'app' or 'function' for error messages
 * @returns {boolean} True if valid
 * @throws {Error} If validation fails
 */
function validatePool(pool, poolType) {
    if (!pool || typeof pool !== 'object') {
        throw new Error(`Invalid ${poolType} pool: must be an object`);
    }

    if (poolType === 'app') {
        for (const [name, app] of Object.entries(pool)) {
            if (!app.name || !app.type) {
                throw new Error(`Invalid app "${name}": missing required 'name' or 'type' property`);
            }
        }
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

export {
    loadJson,
    loadFromFile,
    loadFromUrl,
    loadAppPool,
    loadFunctionPool,
    loadPoolsFromDirectory,
    loadPoolsFromApi,
    validatePool,
    getDefaultConfigDir
};
