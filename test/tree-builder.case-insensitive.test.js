/**
 * Unit tests for TreeBuilder
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TreeBuilder, ref, asyncRef } from '../tree-builder.js';

describe('TreeBuilder', () => {
    let builder;

    beforeEach(() => {
        builder = new TreeBuilder();
    });

    describe('case-insensitive lookup', () => {
        it('should resolve refs case-insensitively', async () => {
            builder.defineFunctions({
                myfunction: { displayName: 'MyFunction' }
            });

            // Ref with different casing should still resolve
            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'MyFunction' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].type, 'function');
            assert.equal(tree.children[0].name, 'MyFunction');
        });

        it('should use displayName in output when pool key is lowercase', async () => {
            builder.defineFunctions({
                publishtrxnholdsreleaseevent: {
                    displayName: 'publishTrxnHoldsReleaseEvent',
                    app: 'dev-nims-ias-publish-events'
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'PublishTrxnHoldsReleaseEvent' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].name, 'publishTrxnHoldsReleaseEvent');
            assert.equal(tree.children[0].metadata_lines[0].text, 'dev-nims-ias-publish-events');
        });

        it('should handle async refs case-insensitively', async () => {
            builder.defineFunctions({
                asyncfunc: {
                    displayName: 'AsyncFunc',
                    queueName: 'ASYNC_QUEUE'
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'ASYNCFUNC', async: true }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].type, 'timer');
            assert.equal(tree.children[0].name, 'ASYNC_QUEUE');
            assert.equal(tree.children[0].children[0].name, 'AsyncFunc');
        });

        it('should use displayName for default queue name in async refs', async () => {
            builder.defineFunctions({
                myfunc: {
                    displayName: 'MyFunc'
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'MYFUNC', async: true }]
            };

            const tree = await builder.build(app);
            // Default queue name should use displayName, not the ref casing
            assert.equal(tree.children[0].name, 'MyFunc_queue');
        });

        it('should resolve nested refs case-insensitively', async () => {
            builder.defineFunctions({
                childfunc: { displayName: 'ChildFunc' },
                parentfunc: {
                    displayName: 'ParentFunc',
                    children: [ref('CHILDFUNC')]
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'parentFunc' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].name, 'ParentFunc');
            assert.equal(tree.children[0].children[0].name, 'ChildFunc');
        });

        it('should detect inline function loops case-insensitively', async () => {
            builder.defineFunctions({
                myfunc: {}
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{
                    name: 'MyFunc',
                    type: 'function',
                    children: [{ ref: 'myfunc' }]
                }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].children[0].type, 'dupe-stopper');
        });

        it('should handle indirect self-reference through concurrent children without infinite loop', async () => {
            // Diamond with cycle-back: A -> [B, C] (resolved concurrently via Promise.all)
            // B -> D -> A (cycle), C -> D -> A (cycle)
            // Without proper in-flight dedup, B and C both try to resolve D concurrently,
            // and D tries to resolve A which is still being resolved (no pre-cached placeholder).
            builder.defineFunctions({
                A: { children: [ref('B'), ref('C')] },
                B: { children: [ref('D')] },
                C: { children: [ref('D')] },
                D: { children: [ref('A')] }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'A' }]
            };

            // Should complete without hanging or stack overflow
            const tree = await builder.build(app);

            // A should resolve successfully
            assert.equal(tree.children[0].name, 'A');
            assert.equal(tree.children[0].type, 'function');

            // B and C should both have D as a child
            const funcA = tree.children[0];
            const funcB = funcA.children[0];
            const funcC = funcA.children[1];
            assert.equal(funcB.name, 'B');
            assert.equal(funcC.name, 'C');

            const dFromB = funcB.children[0];
            const dFromC = funcC.children[0];
            assert.equal(dFromB.name, 'D');
            assert.equal(dFromC.name, 'D');

            // D's child should be a cycle stopper for A (since A is in the visited path)
            assert.equal(dFromB.children[0].type, 'dupe-stopper');
            assert.ok(dFromB.children[0].name.includes('A'));
            assert.equal(dFromC.children[0].type, 'dupe-stopper');
            assert.ok(dFromC.children[0].name.includes('A'));
        });

        it('should handle concurrent async resolution of a function that cycles back', async () => {
            // A -> [asyncRef(B), asyncRef(C)]
            // B -> D (sync), C -> D (sync), D -> A (sync)
            // The async resolver introduces real delays so B and C resolve concurrently,
            // both needing D which cycles back to A.
            const asyncBuilder = new TreeBuilder();
            asyncBuilder.defineFunctions({
                A: { children: [asyncRef('B'), asyncRef('C')] },
                B: { children: [ref('D')] },
                C: { children: [ref('D')] },
                D: { children: [ref('A')] }
            });

            asyncBuilder.setAsyncResolver(async (funcName) => {
                // Introduce delay to force genuine concurrency
                await new Promise(resolve => setTimeout(resolve, 10));
                return {};
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'A' }]
            };

            // Should complete without hanging (timeout would indicate infinite loop)
            const tree = await asyncBuilder.build(app);
            assert.equal(tree.children[0].name, 'A');
            assert.equal(tree.children[0].type, 'function');
        });

        it('should handle deep indirect cycle: A -> B -> C -> D -> E -> A', async () => {
            // Long chain that eventually cycles back to the root.
            // Tests that visited set is properly propagated through many levels.
            builder.defineFunctions({
                A: { children: [ref('B')] },
                B: { children: [ref('C')] },
                C: { children: [ref('D')] },
                D: { children: [ref('E')] },
                E: { children: [ref('A')] }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'A' }]
            };

            const tree = await builder.build(app);

            // Walk down the chain
            const funcA = tree.children[0];
            assert.equal(funcA.name, 'A');
            const funcB = funcA.children[0];
            assert.equal(funcB.name, 'B');
            const funcC = funcB.children[0];
            assert.equal(funcC.name, 'C');
            const funcD = funcC.children[0];
            assert.equal(funcD.name, 'D');
            const funcE = funcD.children[0];
            assert.equal(funcE.name, 'E');

            // E's child should be a cycle stopper for A
            assert.equal(funcE.children[0].type, 'dupe-stopper');
            assert.ok(funcE.children[0].name.includes('A'));
            assert.deepEqual(funcE.children[0]._path, ['A', 'B', 'C', 'D', 'E', 'A']);
        });

        it('should handle function reachable from multiple independent paths with different cycle contexts', async () => {
            // Root -> [A, B] where A -> shared -> A (cycle) and B -> shared -> B (cycle)
            // "shared" is reached with different visited sets from A vs B.
            // Tests that cycle-aware caching produces correct stoppers for each context.
            builder.defineFunctions({
                A: { children: [ref('shared')] },
                B: { children: [ref('shared')] },
                shared: { children: [ref('A'), ref('B')] }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'A' }, { ref: 'B' }]
            };

            const tree = await builder.build(app);

            // Path through A: A -> shared -> [cycle(A), B]
            const funcA = tree.children[0];
            assert.equal(funcA.name, 'A');
            const sharedFromA = funcA.children[0];
            assert.equal(sharedFromA.name, 'shared');
            // shared's first child is ref to A - should be cycle stopper (A is in visited)
            assert.equal(sharedFromA.children[0].type, 'dupe-stopper');
            assert.ok(sharedFromA.children[0].name.includes('A'));

            // Path through B: B -> shared -> [A, cycle(B)]
            const funcB = tree.children[1];
            assert.equal(funcB.name, 'B');
            const sharedFromB = funcB.children[0];
            assert.equal(sharedFromB.name, 'shared');
            // shared's second child is ref to B - should be cycle stopper (B is in visited)
            assert.equal(sharedFromB.children[1].type, 'dupe-stopper');
            assert.ok(sharedFromB.children[1].name.includes('B'));
        });
    });


});
