import { TreeBuilder, ref, asyncRef, topicPublishRef } from './tree-builder.js';
import { applicationPool } from './appPool.js';
import { functionPool } from './functionPool.js';

// Example usage
async function main() {
  console.log('Tree Builder Example\n');

  // Create a tree builder instance
  const builder = new TreeBuilder();

  // Define functions from the function pool
  builder.defineFunctions(functionPool);

  // Build a tree from one of the applications
  const appName = 'nims-wt-pend-process-app';
  console.log(`Building tree for: ${appName}`);

  const tree = await builder.build(applicationPool[appName]);

  // Display the tree
  console.log('\nGenerated Tree:');
  console.log(JSON.stringify(tree, null, 2));

  console.log('\n✓ Tree built successfully!');
}

// Run the example
main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
