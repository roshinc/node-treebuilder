/**
 * Example: Loading pool configurations from JSON files
 *
 * This demonstrates how to use pure JSON configuration files
 * instead of JavaScript modules with helper functions.
 *
 * App configs are stored as individual JSON files (one per app),
 * which reflects how you'd fetch them from a REST API by app name.
 */

import { TreeBuilder } from './tree-builder.js';
import {
    loadApp,
    loadFunctionPoolFromDirectory,
    listAvailableApps,
    validateApp,
    validateFunctionPool,
    getDefaultConfigDir,
    getDefaultAppsDir
} from './json-loader.js';

async function main() {
    console.log('Tree Builder - JSON Configuration Example\n');

    const configDir = getDefaultConfigDir();
    const appsDir = getDefaultAppsDir();

    // Load the function pool (shared across all apps)
    console.log(`Loading function pool from: ${configDir}`);
    const functionPool = await loadFunctionPoolFromDirectory(configDir);
    validateFunctionPool(functionPool);
    console.log('Function pool loaded and validated\n');

    // List available apps
    const availableApps = await listAvailableApps(appsDir);
    console.log('Available apps:');
    availableApps.forEach(app => console.log(`  - ${app}`));
    console.log();

    // Create a tree builder instance and load function definitions
    const builder = new TreeBuilder();
    builder.defineFunctions(functionPool);

    // Load and build tree for a single app (simulating REST fetch by app name)
    const appName = 'nims-exceptions-app';
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Loading app config for: ${appName}`);
    console.log('='.repeat(60));

    const appConfig = await loadApp(appName, appsDir);
    validateApp(appConfig);

    console.log('App config loaded:');
    console.log(JSON.stringify(appConfig, null, 2));

    console.log('\nBuilding tree...');
    const tree = await builder.build(appConfig);

    console.log('\nResolved tree:');
    console.log(JSON.stringify(tree, null, 2));

    // Demo: Build trees for all available apps
    console.log(`\n\n${'='.repeat(60)}`);
    console.log('Building trees for all available apps');
    console.log('='.repeat(60));

    for (const name of availableApps) {
        const config = await loadApp(name, appsDir);
        validateApp(config);
        const appTree = await builder.build(config);

        const childCount = appTree.children?.length || 0;
        const refs = appTree.children?.filter(c => c.type === 'function').length || 0;
        const services = appTree.children?.filter(c => c.type === 'ui-services').length || 0;

        console.log(`\n${name}:`);
        console.log(`  Direct children: ${childCount}`);
        console.log(`  - Function refs: ${refs}`);
        console.log(`  - UI Services: ${services}`);
    }

    console.log('\nDone!');
}

// Example of how you'd use this with a REST API
function exampleRestUsage() {
    /*
    import { loadAppFromUrl, loadFunctionPool } from './json-loader.js';

    // Fetch app config from REST API by app name
    const appConfig = await loadAppFromUrl(
        `https://api.example.com/apps/nims-wt-pend-process-app`,
        { headers: { 'Authorization': 'Bearer token' } }
    );

    // Fetch function pool
    const functionPool = await loadFunctionPool(
        'https://api.example.com/config/functionPool'
    );

    // Build tree
    const builder = new TreeBuilder();
    builder.defineFunctions(functionPool);
    const tree = await builder.build(appConfig);
    */
}

// Run
main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
