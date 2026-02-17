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

    describe('unresolved reference severity', () => {
        it('should use warning type by default for undefined functions', async () => {
            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'missingFunc' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].type, 'warning');
            assert.ok(tree.children[0].name.includes('missingFunc'));
            assert.ok(tree.children[0].name.includes('could not be resolved'));
        });

        it('should use error type when configured', async () => {
            const errorBuilder = new TreeBuilder({ unresolvedSeverity: 'error' });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'missingFunc' }]
            };

            const tree = await errorBuilder.build(app);
            assert.equal(tree.children[0].type, 'error');
            assert.equal(tree.children[0].name, 'dependency to missingFunc could not be resolved so the tree may be incomplete');
            assert.equal(tree.children[0]._unresolvedRef, 'missingFunc');
        });

        it('should use warning type when explicitly configured', async () => {
            const warningBuilder = new TreeBuilder({ unresolvedSeverity: 'warning' });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'missingFunc' }]
            };

            const tree = await warningBuilder.build(app);
            assert.equal(tree.children[0].type, 'warning');
        });

        it('should handle unresolved async refs with configured severity', async () => {
            const errorBuilder = new TreeBuilder({ unresolvedSeverity: 'error' });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'missingAsyncFunc', async: true }]
            };

            const tree = await errorBuilder.build(app);
            // Async ref wraps in timer, child should be error
            assert.equal(tree.children[0].type, 'timer');
            assert.equal(tree.children[0].children[0].type, 'error');
            assert.equal(tree.children[0].children[0]._unresolvedRef, 'missingAsyncFunc');
        });

        it('should handle unresolved nested refs with configured severity', async () => {
            const errorBuilder = new TreeBuilder({ unresolvedSeverity: 'error' });
            errorBuilder.defineFunctions({
                parentFunc: {
                    children: [ref('missingChild')]
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'parentFunc' }]
            };

            const tree = await errorBuilder.build(app);
            assert.equal(tree.children[0].name, 'parentFunc');
            assert.equal(tree.children[0].type, 'function');
            assert.equal(tree.children[0].children[0].type, 'error');
            assert.equal(tree.children[0].children[0]._unresolvedRef, 'missingChild');
        });

        it('should include _unresolvedRef property for easy identification', async () => {
            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'unknownFunction' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0]._unresolvedRef, 'unknownFunction');
        });
    });


});
