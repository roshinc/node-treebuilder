/**
 * Unit tests for TreeBuilder showMinimal config
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TreeBuilder, ref, asyncRef } from '../tree-builder.js';

describe('TreeBuilder showMinimal', () => {
    let builder;

    beforeEach(() => {
        builder = new TreeBuilder({ showMinimal: true });
    });

    describe('default behavior', () => {
        it('should not add collapsed when showMinimal is false (default)', async () => {
            const defaultBuilder = new TreeBuilder();
            defaultBuilder.defineFunctions({
                parent: { app: 'test-app', children: [ref('child')] },
                child: { app: 'other-app' }
            });

            const tree = await defaultBuilder.build({
                name: 'test-app', type: 'app',
                children: [ref('parent')]
            });

            assert.equal(tree.children[0].collapsed, undefined);
        });
    });

    describe('same-app functions (no boundary crossed)', () => {
        it('should not collapse function with matching app', async () => {
            builder.defineFunctions({
                parent: { app: 'test-app', children: [ref('child')] },
                child: { app: 'test-app' }
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('parent')]
            });

            assert.equal(tree.children[0].type, 'function');
            assert.equal(tree.children[0].collapsed, undefined);
        });

        it('should not set collapsed on leaf function with matching app', async () => {
            builder.defineFunctions({ leaf: { app: 'test-app' } });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('leaf')]
            });

            assert.equal(tree.children[0].type, 'function');
            assert.equal(tree.children[0].collapsed, undefined);
        });

        it('should not collapse chain of same-app functions (A -> B -> C)', async () => {
            builder.defineFunctions({
                a: { app: 'test-app', children: [ref('b')] },
                b: { app: 'test-app', children: [ref('c')] },
                c: { app: 'test-app' }
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('a')]
            });

            const a = tree.children[0];
            const b = a.children[0];
            const c = b.children[0];

            assert.equal(a.collapsed, undefined);
            assert.equal(b.collapsed, undefined);
            assert.equal(c.collapsed, undefined);
        });
    });

    describe('app boundary crossing', () => {
        it('should collapse function with different app', async () => {
            builder.defineFunctions({
                parent: { app: 'other-app', children: [ref('child')] },
                child: { app: 'other-app' }
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('parent')]
            });

            assert.equal(tree.children[0].collapsed, true);
        });

        it('should collapse function with no app (treated as different)', async () => {
            builder.defineFunctions({
                parent: { children: [ref('child')] },
                child: {}
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('parent')]
            });

            assert.equal(tree.children[0].collapsed, true);
        });

        it('should not collapse leaf function with no app (no children to collapse)', async () => {
            builder.defineFunctions({ leaf: {} });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('leaf')]
            });

            assert.equal(tree.children[0].collapsed, undefined);
        });

        it('should collapse at the point where app changes', async () => {
            builder.defineFunctions({
                a: { app: 'test-app', children: [ref('b')] },
                b: { app: 'other-app', children: [ref('c')] },
                c: { app: 'other-app' }
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('a')]
            });

            const a = tree.children[0];
            const b = a.children[0];

            assert.equal(a.collapsed, undefined); // same app
            assert.equal(b.collapsed, true);      // different app, boundary crossed
        });

        it('should keep collapsing even if app name matches again after boundary', async () => {
            builder.defineFunctions({
                a: { app: 'test-app', children: [ref('b')] },
                b: { app: 'other-app', children: [ref('c')] },
                c: { app: 'test-app', children: [ref('d')] },
                d: { app: 'test-app' }
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('a')]
            });

            const a = tree.children[0];
            const b = a.children[0];
            const c = b.children[0];

            assert.equal(a.collapsed, undefined); // same app, no boundary
            assert.equal(b.collapsed, true);      // different app, crosses boundary
            assert.equal(c.collapsed, true);      // same app but boundary already crossed
        });
    });

    describe('ui-service-method nodes', () => {
        it('should not set collapsed on ui-service-method with children', async () => {
            builder.defineFunctions({ funcA: { app: 'test-app' } });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [{
                    name: 'Services', type: 'ui-services',
                    children: [{
                        name: 'method1', type: 'ui-service-method',
                        children: [ref('funcA')]
                    }]
                }]
            });

            const method = tree.children[0].children[0];
            assert.equal(method.type, 'ui-service-method');
            assert.equal(method.collapsed, undefined);
        });

        it('should not set collapsed on empty ui-service-method', async () => {
            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [{
                    name: 'Services', type: 'ui-services',
                    children: [
                        { name: 'empty', type: 'ui-service-method' },
                        { name: 'emptyArr', type: 'ui-service-method', children: [] }
                    ]
                }]
            });

            const methods = tree.children[0].children;
            assert.equal(methods[0].collapsed, undefined);
            assert.equal(methods[1].collapsed, undefined);
        });

        it('should not collapse same-app function under ui-service-method but should collapse different-app nested child', async () => {
            builder.defineFunctions({
                svcFunc: { app: 'test-app', children: [ref('nested')] },
                nested: { app: 'other-app', children: [ref('leaf')] },
                leaf: { app: 'other-app' }
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [{
                    name: 'Services', type: 'ui-services',
                    children: [{
                        name: 'method1', type: 'ui-service-method',
                        children: [ref('svcFunc')]
                    }]
                }]
            });

            const method = tree.children[0].children[0];
            const svcFunc = method.children[0];
            const nested = svcFunc.children[0];

            assert.equal(method.collapsed, undefined);  // ui-service-method never collapsed
            assert.equal(svcFunc.collapsed, undefined);  // same app as root
            assert.equal(nested.collapsed, true);        // different app, boundary crossed
        });
    });

    describe('structural containers', () => {
        it('should not set collapsed on app node', async () => {
            builder.defineFunctions({ funcA: { app: 'test-app' } });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('funcA')]
            });

            assert.equal(tree.type, 'app');
            assert.equal(tree.collapsed, undefined);
        });

        it('should not set collapsed on ui-services node', async () => {
            builder.defineFunctions({ funcA: { app: 'test-app' } });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [{
                    name: 'Services', type: 'ui-services',
                    children: [{
                        name: 'method1', type: 'ui-service-method',
                        children: [ref('funcA')]
                    }]
                }]
            });

            assert.equal(tree.children[0].type, 'ui-services');
            assert.equal(tree.children[0].collapsed, undefined);
        });
    });

    describe('async refs (timer nodes)', () => {
        it('should not collapse same-app inner function of timer', async () => {
            builder.defineFunctions({
                asyncFunc: { app: 'test-app', children: [ref('child')] },
                child: { app: 'test-app' }
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [asyncRef('asyncFunc', 'MY.QUEUE')]
            });

            const timer = tree.children[0];
            const innerFunc = timer.children[0];
            assert.equal(timer.type, 'timer');
            assert.equal(timer.collapsed, undefined);
            assert.equal(innerFunc.type, 'function');
            assert.equal(innerFunc.collapsed, undefined); // same app, timer passes through
        });

        it('should collapse different-app inner function of timer', async () => {
            builder.defineFunctions({
                asyncFunc: { app: 'other-app', children: [ref('child')] },
                child: { app: 'other-app' }
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [asyncRef('asyncFunc', 'MY.QUEUE')]
            });

            const timer = tree.children[0];
            const innerFunc = timer.children[0];
            assert.equal(timer.collapsed, undefined);
            assert.equal(innerFunc.collapsed, true); // different app
        });

        it('should not set collapsed when inner function is a leaf', async () => {
            builder.defineFunctions({ leafAsync: {} });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [asyncRef('leafAsync', 'MY.QUEUE')]
            });

            const timer = tree.children[0];
            const innerFunc = timer.children[0];
            assert.equal(timer.collapsed, undefined);
            assert.equal(innerFunc.collapsed, undefined); // leaf, no children to collapse
        });

        it('should not set collapsed on the timer wrapper itself', async () => {
            builder.defineFunctions({
                asyncFunc: { app: 'other-app', children: [ref('child')] },
                child: { app: 'other-app' }
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [asyncRef('asyncFunc', 'MY.QUEUE')]
            });

            const timer = tree.children[0];
            assert.equal(timer.type, 'timer');
            assert.equal(timer.collapsed, undefined);
            assert.equal(timer.children.length, 1);
            assert.equal(timer.children[0].name, 'asyncFunc');
        });
    });

    describe('same function as sync and async ref', () => {
        it('should not collapse same-app sync or async refs', async () => {
            builder.defineFunctions({
                sharedFunc: { app: 'test-app', children: [ref('child')] },
                child: { app: 'test-app' }
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [
                    ref('sharedFunc'),
                    asyncRef('sharedFunc', 'Q.NAME')
                ]
            });

            const syncRef = tree.children[0];
            const timer = tree.children[1];
            const asyncInner = timer.children[0];

            assert.equal(syncRef.type, 'function');
            assert.equal(syncRef.collapsed, undefined); // same app

            assert.equal(timer.type, 'timer');
            assert.equal(timer.collapsed, undefined);

            assert.equal(asyncInner.type, 'function');
            assert.equal(asyncInner.collapsed, undefined); // same app
        });
    });

    describe('timer inside function', () => {
        it('should collapse nested different-app function but not same-app outer or timer', async () => {
            builder.defineFunctions({
                outer: { app: 'test-app', children: [asyncRef('inner', 'Q.NAME')] },
                inner: { app: 'other-app', children: [ref('leaf')] },
                leaf: { app: 'other-app' }
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('outer')]
            });

            const outer = tree.children[0];
            const timer = outer.children[0];
            const inner = timer.children[0];

            assert.equal(outer.collapsed, undefined); // same app
            assert.equal(timer.collapsed, undefined);
            assert.equal(inner.collapsed, true); // different app, boundary crossed
        });
    });

    describe('cache integrity', () => {
        it('should not mutate cached nodes — rebuild without showMinimal has no collapsed', async () => {
            const minimalBuilder = new TreeBuilder({ showMinimal: true });
            minimalBuilder.defineFunctions({
                parent: { app: 'other-app', children: [ref('child')] },
                child: { app: 'other-app' }
            });

            const app = {
                name: 'test-app', type: 'app',
                children: [ref('parent')]
            };

            // Build with showMinimal — different app function is collapsed
            const minimalTree = await minimalBuilder.build(app);
            assert.equal(minimalTree.children[0].collapsed, true);

            // Build again without showMinimal (new builder, same definitions)
            const normalBuilder = new TreeBuilder();
            normalBuilder.defineFunctions({
                parent: { app: 'other-app', children: [ref('child')] },
                child: { app: 'other-app' }
            });

            const normalTree = await normalBuilder.build(app);
            assert.equal(normalTree.children[0].collapsed, undefined);
        });
    });

    describe('interaction with filtering', () => {
        it('should work alongside filterEmptyUiServiceMethods', async () => {
            const filterBuilder = new TreeBuilder({
                showMinimal: true,
                filterEmptyUiServiceMethods: true
            });
            filterBuilder.defineFunctions({ funcA: { app: 'test-app' } });

            const tree = await filterBuilder.build({
                name: 'test-app', type: 'app',
                children: [{
                    name: 'Services', type: 'ui-services',
                    children: [
                        { name: 'emptyMethod', type: 'ui-service-method' },
                        {
                            name: 'withChildren', type: 'ui-service-method',
                            children: [ref('funcA')]
                        }
                    ]
                }]
            });

            // Empty method was filtered out
            assert.equal(tree.children[0].children.length, 1);
            // ui-service-method is never collapsed
            const method = tree.children[0].children[0];
            assert.equal(method.name, 'withChildren');
            assert.equal(method.collapsed, undefined);
        });
    });

    describe('app field preserved on nodes', () => {
        it('should preserve the app field on resolved function nodes', async () => {
            builder.defineFunctions({
                funcA: { app: 'test-app', children: [ref('funcB')] },
                funcB: { app: 'other-app' }
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('funcA')]
            });

            assert.equal(tree.children[0].app, 'test-app');
            assert.equal(tree.children[0].children[0].app, 'other-app');
        });

        it('should not have app field on nodes without app defined', async () => {
            builder.defineFunctions({
                funcA: { children: [ref('funcB')] },
                funcB: {}
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('funcA')]
            });

            assert.equal(tree.children[0].app, undefined);
        });
    });
});
