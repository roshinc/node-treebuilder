/**
 * Unit tests for TreeBuilder
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TreeBuilder, ref, asyncRef, topicPublishRef } from '../tree-builder.js';

describe('TreeBuilder', () => {
    let builder;

    beforeEach(() => {
        builder = new TreeBuilder();
    });

    describe('constructor', () => {
        it('should create a new instance', () => {
            assert.ok(builder instanceof TreeBuilder);
        });

        it('should initialize empty function definitions', () => {
            assert.equal(builder.functionDefs.size, 0);
        });
    });


    describe('defineFunction', () => {
        it('should define a function with no children', () => {
            builder.defineFunction('myFunc');
            assert.equal(builder.functionDefs.size, 1);
            // Keys are stored lowercase for case-insensitive lookup
            assert.ok(builder.functionDefs.has('myfunc'));
        });

        it('should define a function with children', () => {
            builder.defineFunction('parent', [ref('child1'), ref('child2')]);
            // Keys are stored lowercase for case-insensitive lookup
            const def = builder.functionDefs.get('parent');
            assert.equal(def.children.length, 2);
        });

        it('should define a function with extra properties', () => {
            builder.defineFunction('myFunc', [], { customProp: 'value' });
            // Keys are stored lowercase for case-insensitive lookup
            const def = builder.functionDefs.get('myfunc');
            assert.equal(def.customProp, 'value');
        });

        it('should return the builder for chaining', () => {
            const result = builder.defineFunction('func1');
            assert.equal(result, builder);
        });

        it('should store displayName preserving original case', () => {
            builder.defineFunction('MyFunc');
            const def = builder.functionDefs.get('myfunc');
            assert.equal(def.displayName, 'MyFunc');
        });
    });


    describe('defineFunctions', () => {
        it('should define multiple functions from an object', () => {
            builder.defineFunctions({
                func1: {},
                func2: { children: [ref('func1')] },
                func3: {}
            });
            assert.equal(builder.functionDefs.size, 3);
        });

        it('should handle functions with no children property', () => {
            builder.defineFunctions({
                leafFunc: {}
            });
            // Keys are stored lowercase for case-insensitive lookup
            const def = builder.functionDefs.get('leaffunc');
            assert.deepEqual(def.children, []);
        });

        it('should return the builder for chaining', () => {
            const result = builder.defineFunctions({ func1: {} });
            assert.equal(result, builder);
        });

        it('should store displayName preserving original case', () => {
            builder.defineFunctions({
                MyFunction: {},
                AnotherFunc: { displayName: 'CustomName' }
            });
            // displayName should preserve original case
            assert.equal(builder.functionDefs.get('myfunction').displayName, 'MyFunction');
            // Explicit displayName should be preserved
            assert.equal(builder.functionDefs.get('anotherfunc').displayName, 'CustomName');
        });
    });


    describe('static helper functions', () => {
        it('ref() should create a sync reference object', () => {
            const result = ref('funcName');
            assert.deepEqual(result, { ref: 'funcName' });
        });

        it('asyncRef() should create an async reference object', () => {
            const result = asyncRef('funcName', 'MY.QUEUE');
            assert.deepEqual(result, {
                ref: 'funcName',
                async: true,
                queueName: 'MY.QUEUE'
            });
        });

        it('asyncRef() should merge extra props', () => {
            const result = asyncRef('funcName', 'MY.QUEUE', { priority: 'high' });
            assert.equal(result.priority, 'high');
        });

        it('topicPublishRef() should create a topic publish reference', () => {
            const result = topicPublishRef('eventName', 'QUEUE.NAME');
            assert.equal(result.topicName, 'eventName');
            assert.equal(result.topicPublish, true);
            assert.equal(result.async, false);
            assert.equal(result.queueName, 'QUEUE.NAME');
        });
    });


});
