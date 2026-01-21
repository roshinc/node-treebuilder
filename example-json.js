/**
 * Example: Loading pool configurations from JSON files
 *
 * This demonstrates how to use pure JSON configuration files
 * instead of JavaScript modules with helper functions.
 *
 * The JSON format works directly with TreeBuilder since the
 * ref(), asyncRef(), and topicPublishRef() helpers just create
 * plain objects anyway.
 */

import { TreeBuilder } from './tree-builder.js';
import {
    loadPoolsFromDirectory,
    getDefaultConfigDir,
    validatePool
} from './json-loader.js';

async function main() {
    console.log('Tree Builder - JSON Configuration Example\n');

    // Load pools from JSON files
    const configDir = getDefaultConfigDir();
    console.log(`Loading configuration from: ${configDir}`);

    const { appPool, functionPool } = await loadPoolsFromDirectory(configDir);

    // Validate the loaded configurations
    validatePool(appPool, 'app');
    validatePool(functionPool, 'function');
    console.log('Configuration validated successfully\n');

    // Create a tree builder instance
    const builder = new TreeBuilder();

    // Define functions from the JSON function pool
    // (works exactly the same as the JS-based pool)
    builder.defineFunctions(functionPool);

    // Build trees for all applications
    for (const appName of Object.keys(appPool)) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Building tree for: ${appName}`);
        console.log('='.repeat(60));

        const tree = await builder.build(appPool[appName]);

        // Display summary
        const childCount = tree.children?.length || 0;
        console.log(`  Type: ${tree.type}`);
        console.log(`  Direct children: ${childCount}`);

        // Show first level of children
        if (tree.children) {
            const refs = tree.children.filter(c => c.type === 'function').length;
            const services = tree.children.filter(c => c.type === 'ui-services').length;
            console.log(`  - Function references: ${refs}`);
            console.log(`  - UI Services: ${services}`);
        }
    }

    // Demo: Build and output full tree for one app
    console.log('\n\n' + '='.repeat(60));
    console.log('Full tree output for nims-exceptions-app:');
    console.log('='.repeat(60));

    const exceptionTree = await builder.build(appPool['nims-exceptions-app']);
    console.log(JSON.stringify(exceptionTree, null, 2));

    console.log('\nDone!');
}

// Example of loading from a REST API (commented out)
async function exampleApiUsage() {
    /*
    import { loadPoolsFromApi } from './json-loader.js';

    // Load from REST endpoints
    const { appPool, functionPool } = await loadPoolsFromApi(
        'https://api.example.com/config/appPool',
        'https://api.example.com/config/functionPool',
        {
            headers: {
                'Authorization': 'Bearer your-token'
            }
        }
    );

    // Use with TreeBuilder as normal
    const builder = new TreeBuilder();
    builder.defineFunctions(functionPool);
    const tree = await builder.build(appPool['my-app']);
    */
}

// Run
main().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
