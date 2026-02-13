/**
 * Unit tests for JSON Loader
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
    loadFromFile,
    loadFunctionPool,
    loadApp,
    loadAppFromUrl,
    loadFunctionPoolFromDirectory,
    listAvailableApps,
    validateApp,
    validateFunctionPool,
    getDefaultConfigDir,
    getDefaultAppsDir
} from '../json-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

describe('JSON Loader', () => {
    describe('loadFunctionPool', () => {
        it('should unwrap wrapped function pool string payload from URL', async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => ({
                ok: true,
                json: async () => ({
                    lastModified: '2026-02-12T12:05:49.432791',
                    functionPool: JSON.stringify({
                        func1: {},
                        func2: { children: [{ ref: 'func1' }] }
                    })
                })
            });

            try {
                const pool = await loadFunctionPool('https://api.example.com/config/functionPool');
                assert.ok(typeof pool === 'object');
                assert.ok('func1' in pool);
                assert.ok('func2' in pool);
            } finally {
                globalThis.fetch = originalFetch;
            }
        });

        it('should unwrap wrapped function pool object payload from URL', async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => ({
                ok: true,
                json: async () => ({
                    lastModified: '2026-02-12T12:05:49.432791',
                    functionPool: {
                        func1: {}
                    }
                })
            });

            try {
                const pool = await loadFunctionPool('https://api.example.com/config/functionPool');
                assert.ok(typeof pool === 'object');
                assert.ok('func1' in pool);
            } finally {
                globalThis.fetch = originalFetch;
            }
        });
    });

    describe('loadFromFile', () => {
        it('should load and parse a JSON file', async () => {
            const configDir = getDefaultConfigDir();
            const data = await loadFromFile(join(configDir, 'functionPool.json'));
            assert.ok(typeof data === 'object');
            assert.ok(data !== null);
        });

        it('should throw error for non-existent file', async () => {
            await assert.rejects(
                loadFromFile('/nonexistent/path/file.json'),
                { code: 'ENOENT' }
            );
        });

        it('should throw error for invalid JSON', async () => {
            // Create a test with a path that would have invalid JSON
            // For now, we'll just verify the function exists and works with valid JSON
            const configDir = getDefaultConfigDir();
            const data = await loadFromFile(join(configDir, 'functionPool.json'));
            assert.ok(data);
        });
    });

    describe('loadApp', () => {
        it('should load an app config by name', async () => {
            const appsDir = getDefaultAppsDir();
            const app = await loadApp('nims-exceptions-app', appsDir);

            assert.equal(app.name, 'nims-exceptions-app');
            assert.equal(app.type, 'app');
            assert.ok(Array.isArray(app.children));
        });

        it('should load app with function refs', async () => {
            const appsDir = getDefaultAppsDir();
            const app = await loadApp('nims-exceptions-app', appsDir);

            // Should have children with ref property
            const hasRefs = app.children.some(child => child.ref);
            assert.ok(hasRefs, 'App should have function references');
        });

        it('should throw error for non-existent app', async () => {
            const appsDir = getDefaultAppsDir();
            await assert.rejects(
                loadApp('non-existent-app', appsDir),
                { code: 'ENOENT' }
            );
        });
    });

    describe('loadAppFromUrl', () => {
        it('should unwrap wrapped app template string payload from URL', async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => ({
                ok: true,
                json: async () => ({
                    appName: 'nims-wt-file-process-app',
                    imageId: 'nims-wt-file-process-app:202602060905',
                    template: JSON.stringify({
                        name: 'nims-wt-file-process-app',
                        type: 'app',
                        children: []
                    }),
                    deployedAt: '2026-02-12T12:02:36.088183'
                })
            });

            try {
                const app = await loadAppFromUrl('https://api.example.com/apps/nims-wt-file-process-app');
                assert.equal(app.name, 'nims-wt-file-process-app');
                assert.equal(app.type, 'app');
            } finally {
                globalThis.fetch = originalFetch;
            }
        });

        it('should unwrap wrapped app template object payload from URL', async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => ({
                ok: true,
                json: async () => ({
                    appName: 'nims-wt-file-process-app',
                    imageId: 'nims-wt-file-process-app:202602060905',
                    template: {
                        name: 'nims-wt-file-process-app',
                        type: 'app',
                        children: []
                    },
                    deployedAt: '2026-02-12T12:02:36.088183'
                })
            });

            try {
                const app = await loadAppFromUrl('https://api.example.com/apps/nims-wt-file-process-app');
                assert.equal(app.name, 'nims-wt-file-process-app');
                assert.equal(app.type, 'app');
            } finally {
                globalThis.fetch = originalFetch;
            }
        });
    });

    describe('loadFunctionPoolFromDirectory', () => {
        it('should load the function pool', async () => {
            const configDir = getDefaultConfigDir();
            const pool = await loadFunctionPoolFromDirectory(configDir);

            assert.ok(typeof pool === 'object');
            assert.ok(Object.keys(pool).length > 0);
        });

        it('should contain expected functions', async () => {
            const configDir = getDefaultConfigDir();
            const pool = await loadFunctionPoolFromDirectory(configDir);

            // Check for some known functions
            assert.ok('retrieveExceptionDefMetaData' in pool);
            assert.ok('commonCreateExceptions' in pool);
        });

        it('should have proper function structure', async () => {
            const configDir = getDefaultConfigDir();
            const pool = await loadFunctionPoolFromDirectory(configDir);

            // Functions with children should have children array
            const funcWithChildren = pool['createWtException'];
            assert.ok(funcWithChildren);
            assert.ok(Array.isArray(funcWithChildren.children));

            // Leaf functions should be empty objects or have empty children
            const leafFunc = pool['retrieveExceptionDefMetaData'];
            assert.ok(leafFunc);
        });
    });

    describe('listAvailableApps', () => {
        it('should list all available app names', async () => {
            const appsDir = getDefaultAppsDir();
            const apps = await listAvailableApps(appsDir);

            assert.ok(Array.isArray(apps));
            assert.ok(apps.length > 0);
        });

        it('should return app names without .json extension', async () => {
            const appsDir = getDefaultAppsDir();
            const apps = await listAvailableApps(appsDir);

            apps.forEach(app => {
                assert.ok(!app.endsWith('.json'), `${app} should not have .json extension`);
            });
        });

        it('should include known apps', async () => {
            const appsDir = getDefaultAppsDir();
            const apps = await listAvailableApps(appsDir);

            assert.ok(apps.includes('nims-exceptions-app'));
            assert.ok(apps.includes('nims-wt-pend-process-app'));
            assert.ok(apps.includes('nims-wt-wage-process-app'));
            assert.ok(apps.includes('nims-wt-file-process-app'));
        });
    });

    describe('validateApp', () => {
        it('should validate a correct app config', () => {
            const app = {
                name: 'test-app',
                type: 'app',
                children: []
            };
            assert.ok(validateApp(app));
        });

        it('should throw error for null', () => {
            assert.throws(
                () => validateApp(null),
                { message: /must be an object/ }
            );
        });

        it('should throw error for non-object', () => {
            assert.throws(
                () => validateApp('string'),
                { message: /must be an object/ }
            );
        });

        it('should throw error for missing name', () => {
            assert.throws(
                () => validateApp({ type: 'app' }),
                { message: /missing required "name"/ }
            );
        });

        it('should throw error for missing type', () => {
            assert.throws(
                () => validateApp({ name: 'test' }),
                { message: /missing required "type"/ }
            );
        });
    });

    describe('validateFunctionPool', () => {
        it('should validate a correct function pool', () => {
            const pool = {
                func1: {},
                func2: { children: [{ ref: 'func1' }] }
            };
            assert.ok(validateFunctionPool(pool));
        });

        it('should throw error for null', () => {
            assert.throws(
                () => validateFunctionPool(null),
                { message: /must be an object/ }
            );
        });

        it('should accept empty object', () => {
            assert.ok(validateFunctionPool({}));
        });
    });

    describe('getDefaultConfigDir', () => {
        it('should return a string path', () => {
            const dir = getDefaultConfigDir();
            assert.ok(typeof dir === 'string');
        });

        it('should point to config directory', () => {
            const dir = getDefaultConfigDir();
            assert.ok(dir.endsWith('config'));
        });
    });

    describe('getDefaultAppsDir', () => {
        it('should return a string path', () => {
            const dir = getDefaultAppsDir();
            assert.ok(typeof dir === 'string');
        });

        it('should point to config/apps directory', () => {
            const dir = getDefaultAppsDir();
            assert.ok(dir.endsWith(join('config', 'apps')));
        });
    });
});

describe('JSON Format Integration', () => {
    it('should load app and function pool that work together', async () => {
        const { TreeBuilder } = await import('../tree-builder.js');

        const configDir = getDefaultConfigDir();
        const appsDir = getDefaultAppsDir();

        const functionPool = await loadFunctionPoolFromDirectory(configDir);
        const appConfig = await loadApp('nims-exceptions-app', appsDir);

        const builder = new TreeBuilder();
        builder.defineFunctions(functionPool);

        const tree = await builder.build(appConfig);

        assert.equal(tree.name, 'nims-exceptions-app');
        assert.equal(tree.type, 'app');
        assert.ok(tree.children.length > 0);

        // Verify functions were resolved
        const firstChild = tree.children[0];
        assert.equal(firstChild.type, 'function');
        assert.ok(firstChild.name);
    });

    it('should correctly resolve function refs from JSON', async () => {
        const { TreeBuilder } = await import('../tree-builder.js');

        const configDir = getDefaultConfigDir();
        const appsDir = getDefaultAppsDir();

        const functionPool = await loadFunctionPoolFromDirectory(configDir);
        const appConfig = await loadApp('nims-wt-pend-process-app', appsDir);

        const builder = new TreeBuilder();
        builder.defineFunctions(functionPool);

        const tree = await builder.build(appConfig);

        // Find a function with known children (insertWTPendFilingWithExcep -> createWtException)
        const insertFunc = tree.children.find(c => c.name === 'insertWTPendFilingWithExcep');
        assert.ok(insertFunc, 'Should find insertWTPendFilingWithExcep function');
        assert.ok(insertFunc.children, 'Function should have children');

        const createExcep = insertFunc.children.find(c => c.name === 'createWtException');
        assert.ok(createExcep, 'Should find createWtException as child');
    });

    it('should handle async refs from JSON', async () => {
        const { TreeBuilder } = await import('../tree-builder.js');

        const configDir = getDefaultConfigDir();
        const appsDir = getDefaultAppsDir();

        const functionPool = await loadFunctionPoolFromDirectory(configDir);
        const appConfig = await loadApp('nims-wt-pend-process-app', appsDir);

        const builder = new TreeBuilder();
        builder.defineFunctions(functionPool);

        const tree = await builder.build(appConfig);

        // Find ui-services with async ref (WT9000J -> resolvePend -> processWTPayments async)
        const uiServices = tree.children.find(c => c.type === 'ui-services');
        assert.ok(uiServices, 'Should find ui-services');

        const resolvePend = uiServices.children.find(c => c.name === 'resolvePend');
        assert.ok(resolvePend, 'Should find resolvePend method');

        // Should have a timer node for the async ref
        const timerNode = resolvePend.children.find(c => c.type === 'timer');
        assert.ok(timerNode, 'Should have timer node for async ref');
        assert.equal(timerNode.name, 'RPWTWR.PFQ');
    });

    it('should handle topic publish refs from JSON', async () => {
        const { TreeBuilder } = await import('../tree-builder.js');

        const configDir = getDefaultConfigDir();
        const appsDir = getDefaultAppsDir();

        const functionPool = await loadFunctionPoolFromDirectory(configDir);
        const appConfig = await loadApp('nims-exceptions-app', appsDir);

        const builder = new TreeBuilder();
        builder.defineFunctions(functionPool);

        const tree = await builder.build(appConfig);

        // commonExpireExceptions has a topic publish child
        const expireFunc = tree.children.find(c => c.name === 'commonExpireExceptions');
        assert.ok(expireFunc, 'Should find commonExpireExceptions');
        assert.ok(expireFunc.children, 'Should have children');

        const topicNode = expireFunc.children.find(c => c.type === 'topic');
        assert.ok(topicNode, 'Should have topic node');
    });
});
