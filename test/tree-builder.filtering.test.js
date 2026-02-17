/**
 * Unit tests for TreeBuilder
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TreeBuilder, ref } from '../tree-builder.js';

describe('TreeBuilder', () => {
    let builder;

    beforeEach(() => {
        builder = new TreeBuilder();
    });

    describe('filter empty ui-service-methods', () => {
        it('should not filter empty methods when filterEmptyUiServiceMethods is false (default)', async () => {
            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'ServiceGroup',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' },
                            { name: 'anotherEmpty', type: 'ui-service-method', children: [] }
                        ]
                    }
                ]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].children.length, 2);
        });

        it('should filter out empty ui-service-methods when configured', async () => {
            const filterBuilder = new TreeBuilder({ filterEmptyUiServiceMethods: true });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'ServiceGroup',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' },
                            { name: 'anotherEmpty', type: 'ui-service-method', children: [] }
                        ]
                    }
                ]
            };

            const tree = await filterBuilder.build(app);
            assert.equal(tree.children[0].children.length, 0);
        });

        it('should keep ui-service-methods with children when filtering', async () => {
            const filterBuilder = new TreeBuilder({ filterEmptyUiServiceMethods: true });
            filterBuilder.defineFunctions({
                helperFunc: {}
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'ServiceGroup',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' },
                            {
                                name: 'methodWithChild',
                                type: 'ui-service-method',
                                children: [{ ref: 'helperFunc' }]
                            }
                        ]
                    }
                ]
            };

            const tree = await filterBuilder.build(app);
            assert.equal(tree.children[0].children.length, 1);
            assert.equal(tree.children[0].children[0].name, 'methodWithChild');
        });
    });


    describe('filter empty ui-services', () => {
        it('should not filter empty ui-services when filterEmptyUiServices is false (default)', async () => {
            const filterBuilder = new TreeBuilder({ filterEmptyUiServiceMethods: true });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'ServiceGroup',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' }
                        ]
                    }
                ]
            };

            const tree = await filterBuilder.build(app);
            // ui-services node should still exist even with no children
            assert.equal(tree.children.length, 1);
            assert.equal(tree.children[0].type, 'ui-services');
            assert.equal(tree.children[0].children.length, 0);
        });

        it('should filter out ui-services with no children when configured', async () => {
            const filterBuilder = new TreeBuilder({
                filterEmptyUiServiceMethods: true,
                filterEmptyUiServices: true
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'ServiceGroup',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' }
                        ]
                    }
                ]
            };

            const tree = await filterBuilder.build(app);
            // ui-services node should be filtered out
            assert.equal(tree.children.length, 0);
        });

        it('should keep ui-services with non-empty methods when filtering', async () => {
            const filterBuilder = new TreeBuilder({
                filterEmptyUiServiceMethods: true,
                filterEmptyUiServices: true
            });
            filterBuilder.defineFunctions({
                helperFunc: {}
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'ServiceGroup',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' },
                            {
                                name: 'methodWithChild',
                                type: 'ui-service-method',
                                children: [{ ref: 'helperFunc' }]
                            }
                        ]
                    }
                ]
            };

            const tree = await filterBuilder.build(app);
            assert.equal(tree.children.length, 1);
            assert.equal(tree.children[0].type, 'ui-services');
            assert.equal(tree.children[0].children.length, 1);
        });

        it('should filter ui-services without filtering methods when only filterEmptyUiServices is true', async () => {
            const filterBuilder = new TreeBuilder({ filterEmptyUiServices: true });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'EmptyServices',
                        type: 'ui-services',
                        children: []
                    },
                    {
                        name: 'ServicesWithEmptyMethods',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' }
                        ]
                    }
                ]
            };

            const tree = await filterBuilder.build(app);
            // First ui-services has no children, filtered out
            // Second ui-services has children (empty method not filtered), kept
            assert.equal(tree.children.length, 1);
            assert.equal(tree.children[0].name, 'ServicesWithEmptyMethods');
            assert.equal(tree.children[0].children.length, 1);
        });

        it('should handle multiple ui-services groups with mixed content', async () => {
            const filterBuilder = new TreeBuilder({
                filterEmptyUiServiceMethods: true,
                filterEmptyUiServices: true
            });
            filterBuilder.defineFunctions({
                funcA: {},
                funcB: {}
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'EmptyGroup',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' }
                        ]
                    },
                    {
                        name: 'NonEmptyGroup',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' },
                            {
                                name: 'methodA',
                                type: 'ui-service-method',
                                children: [{ ref: 'funcA' }]
                            }
                        ]
                    },
                    {
                        name: 'AnotherEmptyGroup',
                        type: 'ui-services',
                        children: []
                    }
                ]
            };

            const tree = await filterBuilder.build(app);
            // Only NonEmptyGroup should remain
            assert.equal(tree.children.length, 1);
            assert.equal(tree.children[0].name, 'NonEmptyGroup');
            assert.equal(tree.children[0].children.length, 1);
            assert.equal(tree.children[0].children[0].name, 'methodA');
        });
    });


});
