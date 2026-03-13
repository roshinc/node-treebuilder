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
                parent: { children: [ref('child')] },
                child: {}
            });

            const tree = await defaultBuilder.build({
                name: 'test-app', type: 'app',
                children: [ref('parent')]
            });

            assert.equal(tree.children[0].collapsed, undefined);
        });
    });

    describe('function nodes', () => {
        it('should not set collapsed on template-level function with children', async () => {
            builder.defineFunctions({
                parent: { children: [ref('child')] },
                child: {}
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('parent')]
            });

            assert.equal(tree.children[0].type, 'function');
            assert.equal(tree.children[0].collapsed, undefined);
        });

        it('should not set collapsed on leaf function', async () => {
            builder.defineFunctions({ leaf: {} });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('leaf')]
            });

            assert.equal(tree.children[0].type, 'function');
            assert.equal(tree.children[0].collapsed, undefined);
        });

        it('should only collapse nested functions, not template-level (A -> B -> C)', async () => {
            builder.defineFunctions({
                a: { children: [ref('b')] },
                b: { children: [ref('c')] },
                c: {}
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('a')]
            });

            const a = tree.children[0];
            const b = a.children[0];
            const c = b.children[0];

            assert.equal(a.collapsed, undefined); // template-level
            assert.equal(b.collapsed, true);       // nested under function a
            assert.equal(c.collapsed, undefined);  // leaf
        });

        it('should collapse deeply nested function but not template-level parent', async () => {
            builder.defineFunctions({
                parent: { children: [ref('child')] },
                child: { children: [ref('grandchild')] },
                grandchild: {}
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('parent')]
            });

            const parent = tree.children[0];
            const child = parent.children[0];

            assert.equal(parent.collapsed, undefined); // template-level
            assert.equal(child.collapsed, true);       // nested, has children
        });
    });

    describe('ui-service-method nodes', () => {
        it('should not set collapsed on ui-service-method with children', async () => {
            builder.defineFunctions({ funcA: {} });

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

        it('should not collapse function under ui-service-method but should collapse its nested child', async () => {
            builder.defineFunctions({
                svcFunc: { children: [ref('nested')] },
                nested: { children: [ref('leaf')] },
                leaf: {}
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
            assert.equal(svcFunc.collapsed, undefined);  // template-level (under ui-service-method)
            assert.equal(nested.collapsed, true);        // nested under function, has children
        });
    });

    describe('structural containers', () => {
        it('should not set collapsed on app node', async () => {
            builder.defineFunctions({ funcA: {} });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('funcA')]
            });

            assert.equal(tree.type, 'app');
            assert.equal(tree.collapsed, undefined);
        });

        it('should not set collapsed on ui-services node', async () => {
            builder.defineFunctions({ funcA: {} });

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
        it('should not set collapsed on template-level inner function of timer', async () => {
            builder.defineFunctions({
                asyncFunc: { children: [ref('child')] },
                child: {}
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
            assert.equal(innerFunc.collapsed, undefined); // template-level (timer passes through)
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
            assert.equal(innerFunc.collapsed, undefined);
        });

        it('should not set collapsed on the timer wrapper itself', async () => {
            builder.defineFunctions({
                asyncFunc: { children: [ref('child')] },
                child: {}
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
        it('should not collapse template-level sync or async refs', async () => {
            builder.defineFunctions({
                sharedFunc: { children: [ref('child')] },
                child: {}
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

            // Sync ref is template-level, not collapsed
            assert.equal(syncRef.type, 'function');
            assert.equal(syncRef.collapsed, undefined);

            // Timer does NOT get collapsed
            assert.equal(timer.type, 'timer');
            assert.equal(timer.collapsed, undefined);

            // Inner function is template-level (timer passes through), not collapsed
            assert.equal(asyncInner.type, 'function');
            assert.equal(asyncInner.collapsed, undefined);
        });
    });

    describe('timer inside function', () => {
        it('should collapse nested inner function but not template-level outer or the timer', async () => {
            builder.defineFunctions({
                outer: { children: [asyncRef('inner', 'Q.NAME')] },
                inner: { children: [ref('leaf')] },
                leaf: {}
            });

            const tree = await builder.build({
                name: 'test-app', type: 'app',
                children: [ref('outer')]
            });

            const outer = tree.children[0];
            const timer = outer.children[0];
            const inner = timer.children[0];

            assert.equal(outer.collapsed, undefined); // template-level
            assert.equal(timer.collapsed, undefined);
            assert.equal(inner.collapsed, true); // nested under function outer
        });
    });

    describe('cache integrity', () => {
        it('should not mutate cached nodes — rebuild without showMinimal has no collapsed', async () => {
            const minimalBuilder = new TreeBuilder({ showMinimal: true });
            minimalBuilder.defineFunctions({
                parent: { children: [ref('child')] },
                child: {}
            });

            const app = {
                name: 'test-app', type: 'app',
                children: [ref('parent')]
            };

            // Build with showMinimal — template-level function is not collapsed
            const minimalTree = await minimalBuilder.build(app);
            assert.equal(minimalTree.children[0].collapsed, undefined);

            // Build again without showMinimal (new builder, same definitions)
            const normalBuilder = new TreeBuilder();
            normalBuilder.defineFunctions({
                parent: { children: [ref('child')] },
                child: {}
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
            filterBuilder.defineFunctions({ funcA: {} });

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
});
