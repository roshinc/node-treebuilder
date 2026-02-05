# node-treebuilder

A Node.js utility for building hierarchical tree structures from application and function pool definitions. Supports sync/async function references, topic publishing, and cycle detection.

## Installation

```bash
npm install
```

## Usage

### Using JSON Configuration (Recommended)

Load app and function configurations from JSON files:

```javascript
import { TreeBuilder } from './tree-builder.js';
import {
    loadApp,
    loadFunctionPoolFromDirectory,
    getDefaultConfigDir,
    getDefaultAppsDir
} from './json-loader.js';

// Load function pool (shared across all apps)
const functionPool = await loadFunctionPoolFromDirectory(getDefaultConfigDir());

// Load a specific app config
const appConfig = await loadApp('nims-exceptions-app', getDefaultAppsDir());

// Build the tree
const builder = new TreeBuilder();
builder.defineFunctions(functionPool);
const tree = await builder.build(appConfig);

console.log(JSON.stringify(tree, null, 2));
```

### Using JavaScript Configuration

```javascript
import { TreeBuilder, ref, asyncRef, topicPublishRef } from './tree-builder.js';

const builder = new TreeBuilder();

// Define functions
builder.defineFunctions({
    'childFunc': {},
    'parentFunc': {
        children: [ref('childFunc')]
    }
});

// Build tree from app structure
const tree = await builder.build({
    name: 'my-app',
    type: 'app',
    children: [
        { ref: 'parentFunc' }
    ]
});
```

## JSON Configuration Format

### App Configuration (`config/apps/*.json`)

Each app is stored as a separate JSON file:

```json
{
    "name": "my-app",
    "type": "app",
    "children": [
        { "ref": "functionName" },
        { "ref": "asyncFunction", "async": true, "queueName": "QUEUE.NAME" },
        {
            "name": "ServiceGroup",
            "type": "ui-services",
            "children": [
                {
                    "name": "methodName",
                    "type": "ui-service-method",
                    "children": [
                        { "ref": "helperFunction" }
                    ]
                }
            ]
        }
    ]
}
```

### Function Pool (`config/functionPool.json`)

```json
{
    "leafFunction": {},
    "parentFunction": {
        "children": [
            { "ref": "leafFunction" }
        ]
    },
    "functionWithQueueName": {
        "app": "MyApp",
        "queueName": "MY.DEFAULT.QUEUE",
        "children": [
            { "ref": "leafFunction" }
        ]
    },
    "publisherFunction": {
        "children": [
            { "topicName": "eventName", "topicPublish": true }
        ]
    }
}
```

#### Function Pool Properties

| Property | Description |
|----------|-------------|
| `app` | Application name, transformed into a metadata_line |
| `queueName` | Default queue name for async references to this function |
| `children` | Array of child references (sync, async, or topic) |
| `metadata_lines` | Array of metadata objects for display |

**Note:** The `queueName` property is used as a default when the function is referenced asynchronously. It is passed to the async resolver and used as a fallback if neither the resolver nor the inline reference specifies a queue name.

### Reference Types

| Type | JSON Format | Description |
|------|-------------|-------------|
| Sync | `{ "ref": "funcName" }` | Direct function reference |
| Async | `{ "ref": "funcName", "async": true, "queueName": "Q.NAME" }` | Wrapped in timer/queue node |
| Topic | `{ "topicName": "event", "topicPublish": true, "queueName": "Q.NAME" }` | Publish to topic (queueName optional) |

#### Async Queue Name Resolution

When resolving an async reference, the queue name is determined using this priority (highest to lowest):

1. **Resolver return value** - If an async resolver is set and returns a `queueName`
2. **Inline queueName** - The `queueName` specified in the async reference itself
3. **Function pool queueName** - The `queueName` defined on the function in the function pool
4. **Auto-generated** - Falls back to `{functionName}_queue`

**Example:**
```json
// Function pool
{
    "processPayments": {
        "queueName": "PAYMENTS.QUEUE",
        "children": [...]
    }
}

// App config - async ref without inline queueName uses function's queueName
{
    "children": [
        { "ref": "processPayments", "async": true }  // Uses "PAYMENTS.QUEUE"
    ]
}

// App config - inline queueName overrides function's queueName
{
    "children": [
        { "ref": "processPayments", "async": true, "queueName": "CUSTOM.QUEUE" }  // Uses "CUSTOM.QUEUE"
    ]
}
```

The async resolver also receives the effective queue name (inline or function pool) so it can make decisions based on it.

### Metadata Lines

Any node can include `metadata_lines` - an array of metadata objects that will be preserved in the output tree. This is useful for attaching additional display information to nodes.

```json
{
    "name": "myFunction",
    "type": "function",
    "metadata_lines": [
        {
            "text": "Log: MY_LOG",
            "clickable": true,
            "data": {
                "logType": "MY_LOG",
                "customField": "value"
            }
        },
        {
            "text": "Just a label"
        }
    ]
}
```

**Properties:**
| Property | Required | Description |
|----------|----------|-------------|
| `text` | Yes | Display text for the metadata line |
| `clickable` | No | If `true`, the line is rendered as a clickable link |
| `data` | No | Arbitrary data object attached to this metadata line |

**Example in function pool:**
```json
{
    "createWtException": {
        "metadata_lines": [
            { "text": "Creates WT exceptions" },
            { "text": "Log: WT_EXCEPTION", "clickable": true, "data": { "logType": "WT_EXCEPTION" } }
        ],
        "children": [
            { "ref": "retrieveExceptionDefMetaData" }
        ]
    }
}
```

## Project Structure

```
├── tree-builder.js      # Core TreeBuilder class
├── json-loader.js       # JSON configuration loader
├── config/
│   ├── functionPool.json    # Function definitions
│   └── apps/                # Individual app configs
│       ├── nims-exceptions-app.json
│       ├── nims-wt-pend-process-app.json
│       ├── nims-wt-wage-process-app.json
│       └── nims-wt-file-process-app.json
├── test/
│   ├── tree-builder.test.js
│   └── json-loader.test.js
├── example.js           # JavaScript config example
└── example-json.js      # JSON config example
```

## API

### TreeBuilder

```javascript
const builder = new TreeBuilder(config?);

// Define functions
builder.defineFunction(name, children?, extraProps?);
builder.defineFunctions(functionPoolObject);

// Set resolvers for async/topic references
builder.setAsyncResolver((funcName, queueName) => ({ queueName, depth }));
builder.setTopicPublishResolver((topicName, queueName) => ({ queueName }));

// Build tree
const tree = await builder.build(appStructure);
```

#### Configuration Options

The `TreeBuilder` constructor accepts an optional configuration object:

```javascript
const builder = new TreeBuilder({
    unresolvedSeverity: 'warning',        // 'error' or 'warning' (default: 'warning')
    filterEmptyUiServiceMethods: false,   // Omit ui-service-methods with no children (default: false)
    filterEmptyUiServices: false          // Omit ui-services with no children (default: false)
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `unresolvedSeverity` | `'warning'` | Type of node created for unresolved function references (`'error'` or `'warning'`) |
| `filterEmptyUiServiceMethods` | `false` | When `true`, ui-service-method nodes with no children are omitted from output |
| `filterEmptyUiServices` | `false` | When `true`, ui-services nodes with no children (after filtering methods) are omitted from output |

**Filtering Example:**

```javascript
// Filter out empty UI service methods and empty UI services sections
const builder = new TreeBuilder({
    filterEmptyUiServiceMethods: true,
    filterEmptyUiServices: true
});

const tree = await builder.build({
    name: 'my-app',
    type: 'app',
    children: [
        {
            name: 'ServiceGroup',
            type: 'ui-services',
            children: [
                { name: 'emptyMethod', type: 'ui-service-method' },  // Filtered out (no children)
                {
                    name: 'methodWithFunc',
                    type: 'ui-service-method',
                    children: [{ ref: 'someFunc' }]  // Kept (has children)
                }
            ]
        }
    ]
});
// If all ui-service-methods are filtered out, the ui-services node itself is also omitted
```

### JSON Loader

```javascript
// Load single app by name
const app = await loadApp('app-name', appsDir);

// Load from URL (REST API)
const app = await loadAppFromUrl('https://api.example.com/apps/app-name');

// Load function pool
const pool = await loadFunctionPoolFromDirectory(configDir);
const pool = await loadFunctionPool('https://api.example.com/functionPool');

// List available apps
const apps = await listAvailableApps(appsDir);

// Validation
validateApp(appConfig);
validateFunctionPool(poolConfig);
```

## Running Examples

```bash
# JavaScript-based configuration
npm start

# JSON-based configuration
node example-json.js
```

## Testing

```bash
npm test
```

Runs 93 unit tests covering TreeBuilder and JSON loader functionality.

## License

ISC
