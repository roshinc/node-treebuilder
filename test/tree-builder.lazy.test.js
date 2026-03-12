/**
 * Unit tests for TreeBuilder lazy-loading API (buildLazy / buildLazyFrom)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TreeBuilder, LogDecider, ref, asyncRef, topicPublishRef } from '../tree-builder.js';

describe('TreeBuilder lazy loading', () => {
    let builder;

    beforeEach(() => {
        builder = new TreeBuilder();
    });

    // ── buildLazy ─────────────────────────────────────────────────────

    describe('buildLazy', () => {
        it('should resolve leaf function refs without loadChildren', async () => {
            builder.defineFunctions({
                leafFunc: {}
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('leafFunc')]
            };

            const tree = await builder.buildLazy(app);
            assert.equal(tree.children.length, 1);
            assert.equal(tree.children[0].name, 'leafFunc');
            assert.equal(tree.children[0].type, 'function');
            assert.equal(tree.children[0].loadChildren, undefined);
            assert.equal(tree.children[0].children, undefined);
        });

        it('should set loadChildren on functions with grandchildren', async () => {
            builder.defineFunctions({
                grandchild: {},
                child: { children: [ref('grandchild')] },
                parent: { children: [ref('child')] }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('parent')]
            };

            const tree = await builder.buildLazy(app);
            // parent is resolved with its children
            const parentNode = tree.children[0];
            assert.equal(parentNode.name, 'parent');
            assert.equal(parentNode.type, 'function');
            assert.equal(parentNode.children.length, 1);

            // child has grandchildren → loadChildren: true, no children array
            const childNode = parentNode.children[0];
            assert.equal(childNode.name, 'child');
            assert.equal(childNode.type, 'function');
            assert.equal(childNode.loadChildren, true);
            assert.equal(childNode.children, undefined);
        });

        it('should show timer + inner function together for async refs', async () => {
            builder.defineFunctions({
                grandchild: {},
                asyncFunc: { children: [ref('grandchild')], queueName: 'MY.QUEUE' }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [asyncRef('asyncFunc', 'MY.QUEUE')]
            };

            const tree = await builder.buildLazy(app);
            const timerNode = tree.children[0];
            assert.equal(timerNode.type, 'timer');
            assert.equal(timerNode.name, 'MY.QUEUE');
            assert.equal(timerNode.children.length, 1);

            // inner function resolved with its immediate children
            const funcNode = timerNode.children[0];
            assert.equal(funcNode.name, 'asyncFunc');
            assert.equal(funcNode.type, 'function');
            assert.equal(funcNode.children.length, 1);

            // grandchild is leaf-or-loadable (leaf in this case)
            const grandchildNode = funcNode.children[0];
            assert.equal(grandchildNode.name, 'grandchild');
            assert.equal(grandchildNode.type, 'function');
            assert.equal(grandchildNode.loadChildren, undefined);
        });

        it('should set loadChildren on inner async function if it has deeper children', async () => {
            builder.defineFunctions({
                deep: {},
                grandchild: { children: [ref('deep')] },
                asyncFunc: { children: [ref('grandchild')], queueName: 'MY.QUEUE' }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [asyncRef('asyncFunc', 'MY.QUEUE')]
            };

            const tree = await builder.buildLazy(app);
            const timerNode = tree.children[0];
            const funcNode = timerNode.children[0];
            assert.equal(funcNode.name, 'asyncFunc');
            assert.equal(funcNode.children.length, 1);

            // grandchild has deeper children → loadChildren
            const grandchildNode = funcNode.children[0];
            assert.equal(grandchildNode.name, 'grandchild');
            assert.equal(grandchildNode.loadChildren, true);
            assert.equal(grandchildNode.children, undefined);
        });

        it('should treat ctg as always a leaf with no loadChildren', async () => {
            builder.defineFunctions({
                ctgFunc: { ctg: true }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('ctgFunc')]
            };

            const tree = await builder.buildLazy(app);
            const node = tree.children[0];
            assert.equal(node.name, 'ctgFunc');
            assert.equal(node.type, 'ctg');
            assert.equal(node.loadChildren, undefined);
            assert.equal(node.children, undefined);
        });

        it('should treat topic publish as a leaf', async () => {
            builder.defineFunctions({
                pubFunc: {
                    children: [topicPublishRef('myEvent', 'EVENT.Q')]
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('pubFunc')]
            };

            const tree = await builder.buildLazy(app);
            const funcNode = tree.children[0];
            assert.equal(funcNode.children.length, 1);
            const topicNode = funcNode.children[0];
            assert.equal(topicNode.type, 'topic');
            assert.equal(topicNode.loadChildren, undefined);
        });

        it('should return warning node for unresolved refs', async () => {
            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('nonExistent')]
            };

            const tree = await builder.buildLazy(app);
            assert.equal(tree.children.length, 1);
            assert.equal(tree.children[0].type, 'warning');
            assert.equal(tree.children[0]._unresolvedRef, 'nonExistent');
        });

        it('should detect cycles and return loop', async () => {
            builder.defineFunctions({
                funcA: { children: [ref('funcB')] },
                funcB: { children: [ref('funcA')] }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('funcA')]
            };

            const tree = await builder.buildLazy(app);
            const funcA = tree.children[0];
            assert.equal(funcA.name, 'funcA');
            // funcB is a child resolved as leaf-or-loadable
            const funcB = funcA.children[0];
            assert.equal(funcB.name, 'funcB');
            // funcB has children [ref('funcA')] → loadChildren: true
            // (funcA is in visited, but loadChildren doesn't resolve children so no cycle yet)
            assert.equal(funcB.loadChildren, true);
            assert.equal(funcB.children, undefined);
        });

        it('should preserve ui-services structure with shallow refs inside', async () => {
            builder.defineFunctions({
                grandchild: {},
                helperFunc: { children: [ref('grandchild')] }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'ServiceGroup',
                        type: 'ui-services',
                        children: [
                            {
                                name: 'method1',
                                type: 'ui-service-method',
                                children: [ref('helperFunc')]
                            }
                        ]
                    }
                ]
            };

            const tree = await builder.buildLazy(app);
            const uiServices = tree.children[0];
            assert.equal(uiServices.name, 'ServiceGroup');
            assert.equal(uiServices.type, 'ui-services');

            const method = uiServices.children[0];
            assert.equal(method.name, 'method1');
            assert.equal(method.type, 'ui-service-method');

            // helperFunc is resolved with its children
            const helperNode = method.children[0];
            assert.equal(helperNode.name, 'helperFunc');
            assert.equal(helperNode.type, 'function');
            assert.equal(helperNode.children.length, 1);

            // grandchild is leaf
            const grandchild = helperNode.children[0];
            assert.equal(grandchild.name, 'grandchild');
            assert.equal(grandchild.loadChildren, undefined);
        });

        it('should include SMART child directly on leaf function with usesLegacyGatewayHttpClient', async () => {
            builder.defineFunctions({
                legacyFunc: { usesLegacyGatewayHttpClient: true }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('legacyFunc')]
            };

            const tree = await builder.buildLazy(app);
            const funcNode = tree.children[0];
            assert.equal(funcNode.name, 'legacyFunc');
            // No real children, SMART included directly
            assert.equal(funcNode.loadChildren, undefined);
            assert.equal(funcNode.children.length, 1);
            assert.equal(funcNode.children[0].name, 'SMART Call Over HTTPS');
            assert.equal(funcNode.children[0].type, 'smart');
        });

        it('should set loadChildren on function with children even if usesLegacyGatewayHttpClient', async () => {
            builder.defineFunctions({
                child: {},
                legacyFunc: { children: [ref('child')], usesLegacyGatewayHttpClient: true }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('legacyFunc')]
            };

            const tree = await builder.buildLazy(app);
            const funcNode = tree.children[0];
            // parent has real children → resolved shallowly, SMART also appended
            assert.equal(funcNode.children.length, 2);
            assert.equal(funcNode.children[0].name, 'child');
            assert.equal(funcNode.children[0].type, 'function');
            assert.equal(funcNode.children[1].name, 'SMART Call Over HTTPS');
            assert.equal(funcNode.children[1].type, 'smart');
        });

        it('should set loadChildren on leaf-or-loadable function with children + usesLegacyGatewayHttpClient', async () => {
            builder.defineFunctions({
                grandchild: {},
                innerFunc: { children: [ref('grandchild')], usesLegacyGatewayHttpClient: true },
                parent: { children: [ref('innerFunc')] }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('parent')]
            };

            const tree = await builder.buildLazy(app);
            const parentNode = tree.children[0];
            const innerNode = parentNode.children[0];
            // innerFunc has children → loadChildren, SMART deferred
            assert.equal(innerNode.name, 'innerFunc');
            assert.equal(innerNode.loadChildren, true);
            assert.equal(innerNode.children, undefined);
        });

        it('should filter empty ui-service-methods when configured', async () => {
            builder = new TreeBuilder({ filterEmptyUiServiceMethods: true });
            builder.defineFunctions({});

            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'Services',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method', children: [] },
                            { name: 'nonMethod', type: 'other', children: [] }
                        ]
                    }
                ]
            };

            const tree = await builder.buildLazy(app);
            const services = tree.children[0];
            // emptyMethod filtered out, nonMethod kept
            assert.equal(services.children.length, 1);
            assert.equal(services.children[0].name, 'nonMethod');
        });

        it('should handle metadata_lines and app field correctly', async () => {
            builder.defineFunctions({
                myFunc: {
                    app: 'MyApp',
                    metadata_lines: [{ text: 'DB: TABLE', clickable: true }]
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('myFunc')]
            };

            const tree = await builder.buildLazy(app);
            const funcNode = tree.children[0];
            assert.equal(funcNode.metadata_lines.length, 2);
            assert.equal(funcNode.metadata_lines[0].text, 'MyApp');
            assert.equal(funcNode.metadata_lines[0].clickable, false);
            assert.equal(funcNode.metadata_lines[1].text, 'DB: TABLE');
            assert.equal(funcNode.metadata_lines[1].clickable, true);
        });

        it('should handle case-insensitive function lookup', async () => {
            builder.defineFunctions({
                MyFunc: { children: [ref('ChildFunc')] },
                ChildFunc: {}
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('MYFUNC')]
            };

            const tree = await builder.buildLazy(app);
            const funcNode = tree.children[0];
            assert.equal(funcNode.name, 'MyFunc');
            assert.equal(funcNode.type, 'function');
            assert.equal(funcNode.children.length, 1);
            assert.equal(funcNode.children[0].name, 'ChildFunc');
        });

        it('should not populate resolvedFunctions cache', async () => {
            builder.defineFunctions({
                myFunc: {}
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('myFunc')]
            };

            await builder.buildLazy(app);
            assert.equal(builder.resolvedFunctions.size, 0);
        });

        it('should build a simple app with no children', async () => {
            const app = {
                name: 'test-app',
                type: 'app',
                children: []
            };
            const tree = await builder.buildLazy(app);
            assert.equal(tree.name, 'test-app');
            assert.equal(tree.type, 'app');
            assert.deepEqual(tree.children, []);
        });
    });

    // ── buildLazyFrom ─────────────────────────────────────────────────

    describe('buildLazyFrom', () => {
        it('should return function as root with shallow children', async () => {
            builder.defineFunctions({
                child1: {},
                child2: {},
                myFunc: { children: [ref('child1'), ref('child2')] }
            });

            const tree = await builder.buildLazyFrom('myFunc');
            assert.equal(tree.name, 'myFunc');
            assert.equal(tree.type, 'function');
            assert.equal(tree.children.length, 2);
            assert.equal(tree.children[0].name, 'child1');
            assert.equal(tree.children[1].name, 'child2');
        });

        it('should set loadChildren on children with grandchildren', async () => {
            builder.defineFunctions({
                grandchild: {},
                child: { children: [ref('grandchild')] },
                myFunc: { children: [ref('child')] }
            });

            const tree = await builder.buildLazyFrom('myFunc');
            assert.equal(tree.children.length, 1);
            const childNode = tree.children[0];
            assert.equal(childNode.name, 'child');
            assert.equal(childNode.loadChildren, true);
            assert.equal(childNode.children, undefined);
        });

        it('should return warning for unresolved function name', async () => {
            const tree = await builder.buildLazyFrom('nonExistent');
            assert.equal(tree.type, 'warning');
            assert.equal(tree._unresolvedRef, 'nonExistent');
        });

        it('should show timer + function together for async ref children', async () => {
            builder.defineFunctions({
                deep: {},
                asyncChild: { children: [ref('deep')], queueName: 'CHILD.Q' },
                myFunc: { children: [asyncRef('asyncChild', 'CHILD.Q')] }
            });

            const tree = await builder.buildLazyFrom('myFunc');
            assert.equal(tree.children.length, 1);

            const timerNode = tree.children[0];
            assert.equal(timerNode.type, 'timer');
            assert.equal(timerNode.name, 'CHILD.Q');
            assert.equal(timerNode.children.length, 1);

            const innerFunc = timerNode.children[0];
            assert.equal(innerFunc.name, 'asyncChild');
            assert.equal(innerFunc.loadChildren, true);
            assert.equal(innerFunc.children, undefined);
        });

        it('should handle leaf function (no children)', async () => {
            builder.defineFunctions({
                leafFunc: {}
            });

            const tree = await builder.buildLazyFrom('leafFunc');
            assert.equal(tree.name, 'leafFunc');
            assert.equal(tree.type, 'function');
            assert.equal(tree.loadChildren, undefined);
            assert.equal(tree.children, undefined);
        });

        it('should handle app field on root function', async () => {
            builder.defineFunctions({
                myFunc: { app: 'MyApp' }
            });

            const tree = await builder.buildLazyFrom('myFunc');
            assert.equal(tree.name, 'myFunc');
            assert.equal(tree.metadata_lines.length, 1);
            assert.equal(tree.metadata_lines[0].text, 'MyApp');
        });

        it('should handle case-insensitive lookup', async () => {
            builder.defineFunctions({
                MyFunc: {}
            });

            const tree = await builder.buildLazyFrom('MYFUNC');
            assert.equal(tree.name, 'MyFunc');
            assert.equal(tree.type, 'function');
        });

        it('should handle ctg function', async () => {
            builder.defineFunctions({
                ctgFunc: { ctg: true }
            });

            const tree = await builder.buildLazyFrom('ctgFunc');
            assert.equal(tree.name, 'ctgFunc');
            assert.equal(tree.type, 'ctg');
            assert.equal(tree.loadChildren, undefined);
            assert.equal(tree.children, undefined);
        });
    });

    // ── LogDecider integration ────────────────────────────────────────

    describe('lazy loading with LogDecider', () => {
        it('should apply Logs metadata in buildLazy', async () => {
            builder.setLogDecider(new LogDecider(['function']));
            builder.defineFunctions({
                myFunc: {}
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('myFunc')]
            };

            const tree = await builder.buildLazy(app);
            const funcNode = tree.children[0];
            assert.equal(funcNode.metadata_lines[0].text, 'Logs');
            assert.equal(funcNode.metadata_lines[0].clickable, true);
        });

        it('should apply Logs metadata in buildLazyFrom', async () => {
            builder.setLogDecider(new LogDecider(['function']));
            builder.defineFunctions({
                myFunc: {}
            });

            const tree = await builder.buildLazyFrom('myFunc');
            assert.equal(tree.metadata_lines[0].text, 'Logs');
        });

        it('should apply Logs metadata on leaf-or-loadable nodes', async () => {
            builder.setLogDecider(new LogDecider(['function']));
            builder.defineFunctions({
                grandchild: {},
                child: { children: [ref('grandchild')] },
                parent: { children: [ref('child')] }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('parent')]
            };

            const tree = await builder.buildLazy(app);
            const childNode = tree.children[0].children[0];
            assert.equal(childNode.loadChildren, true);
            assert.equal(childNode.metadata_lines[0].text, 'Logs');
        });
    });

    // ── Cycle detection in lazy mode ────────────────────────────────

    describe('cycle detection in lazy mode', () => {
        it('should produce loop for self-referencing function via buildLazy', async () => {
            builder.defineFunctions({
                selfRef: { children: [ref('selfRef')] }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('selfRef')]
            };

            const tree = await builder.buildLazy(app);
            const selfRefNode = tree.children[0];
            assert.equal(selfRefNode.name, 'selfRef');
            assert.equal(selfRefNode.type, 'function');
            // selfRef is resolved shallowly; its child ref('selfRef') hits visited → loop
            assert.equal(selfRefNode.children.length, 1);
            assert.equal(selfRefNode.children[0].type, 'loop');
            assert.ok(selfRefNode.children[0].name.includes('selfRef'));
            assert.equal(selfRefNode.loadChildren, undefined);
        });

        it('should produce loop for self-referencing function via buildLazyFrom', async () => {
            builder.defineFunctions({
                selfRef: { children: [ref('selfRef')] }
            });

            const result = await builder.buildLazyFrom('selfRef');
            assert.equal(result.name, 'selfRef');
            assert.equal(result.type, 'function');
            assert.equal(result.children.length, 1);
            assert.equal(result.children[0].type, 'loop');
            assert.ok(result.children[0].name.includes('selfRef'));
        });

        it('should set loadChildren (not loop) for A→B→A cycle at depth 1 via buildLazy', async () => {
            builder.defineFunctions({
                funcA: { children: [ref('funcB')] },
                funcB: { children: [ref('funcA')] }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('funcA')]
            };

            const tree = await builder.buildLazy(app);
            const funcA = tree.children[0];
            assert.equal(funcA.name, 'funcA');
            assert.equal(funcA.children.length, 1);

            // funcB is resolved as leaf-or-loadable: it has children → loadChildren: true
            // No loop because funcB is not in visited (only funcA is)
            const funcB = funcA.children[0];
            assert.equal(funcB.name, 'funcB');
            assert.equal(funcB.loadChildren, true);
            assert.equal(funcB.children, undefined);
        });

        it('should not produce loop when expanding A→B→A cycle via buildLazyFrom (fresh visited)', async () => {
            builder.defineFunctions({
                funcA: { children: [ref('funcB')] },
                funcB: { children: [ref('funcA')] }
            });

            // Expanding funcB in isolation — visited starts fresh with only funcB
            const result = await builder.buildLazyFrom('funcB');
            assert.equal(result.name, 'funcB');
            assert.equal(result.children.length, 1);

            // funcA resolved as leaf-or-loadable: has children → loadChildren: true
            // No loop because visited only contains funcB, not funcA
            const funcA = result.children[0];
            assert.equal(funcA.name, 'funcA');
            assert.equal(funcA.loadChildren, true);
            assert.equal(funcA.children, undefined);
        });

        it('should handle A→B→C→A cycle across multiple buildLazyFrom calls without loops', async () => {
            builder.defineFunctions({
                A: { children: [ref('B')] },
                B: { children: [ref('C')] },
                C: { children: [ref('A')] }
            });

            // Each call starts with fresh visited — indirect cycles never trigger loop
            const resultA = await builder.buildLazyFrom('A');
            assert.equal(resultA.children[0].name, 'B');
            assert.equal(resultA.children[0].loadChildren, true);
            assert.equal(resultA.children[0].children, undefined);

            const resultB = await builder.buildLazyFrom('B');
            assert.equal(resultB.children[0].name, 'C');
            assert.equal(resultB.children[0].loadChildren, true);
            assert.equal(resultB.children[0].children, undefined);

            const resultC = await builder.buildLazyFrom('C');
            assert.equal(resultC.children[0].name, 'A');
            assert.equal(resultC.children[0].loadChildren, true);
            assert.equal(resultC.children[0].children, undefined);
        });

        it('should not produce loop for diamond pattern (same function referenced twice)', async () => {
            builder.defineFunctions({
                leaf: {},
                shared: { children: [ref('leaf')] },
                parent: { children: [ref('shared'), ref('shared')] }
            });

            const result = await builder.buildLazyFrom('parent');
            assert.equal(result.children.length, 2);

            // Both refs to shared are resolved independently — no cycle
            assert.equal(result.children[0].name, 'shared');
            assert.equal(result.children[0].loadChildren, true);
            assert.equal(result.children[0].children, undefined);

            assert.equal(result.children[1].name, 'shared');
            assert.equal(result.children[1].loadChildren, true);
            assert.equal(result.children[1].children, undefined);
        });

        it('should handle cycle through async ref via buildLazy', async () => {
            builder.defineFunctions({
                funcA: { children: [asyncRef('funcB', 'Q')] },
                funcB: { children: [ref('funcA')], queueName: 'Q' }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [ref('funcA')]
            };

            const tree = await builder.buildLazy(app);
            const funcA = tree.children[0];
            assert.equal(funcA.name, 'funcA');
            assert.equal(funcA.children.length, 1);

            // async ref produces timer wrapper
            const timerNode = funcA.children[0];
            assert.equal(timerNode.type, 'timer');

            // inner funcB resolved as leaf-or-loadable: has children → loadChildren
            const funcB = timerNode.children[0];
            assert.equal(funcB.name, 'funcB');
            assert.equal(funcB.loadChildren, true);
            assert.equal(funcB.children, undefined);
        });

        it('should handle cycle through async ref via buildLazyFrom', async () => {
            builder.defineFunctions({
                funcA: { children: [asyncRef('funcB', 'Q')] },
                funcB: { children: [ref('funcA')], queueName: 'Q' }
            });

            // Expand funcB — fresh visited, funcA gets loadChildren
            const result = await builder.buildLazyFrom('funcB');
            assert.equal(result.name, 'funcB');
            assert.equal(result.children.length, 1);

            const funcA = result.children[0];
            assert.equal(funcA.name, 'funcA');
            assert.equal(funcA.loadChildren, true);
            assert.equal(funcA.children, undefined);
        });

        it('should produce loop for self-ref even when function has multiple children', async () => {
            builder.defineFunctions({
                leaf: {},
                selfAndOthers: { children: [ref('leaf'), ref('selfAndOthers')] }
            });

            const result = await builder.buildLazyFrom('selfAndOthers');
            assert.equal(result.name, 'selfAndOthers');
            assert.equal(result.children.length, 2);

            // First child: leaf resolved normally
            assert.equal(result.children[0].name, 'leaf');
            assert.equal(result.children[0].type, 'function');

            // Second child: self-ref hits visited → loop
            assert.equal(result.children[1].type, 'loop');
            assert.ok(result.children[1].name.includes('selfAndOthers'));
        });
    });
});
