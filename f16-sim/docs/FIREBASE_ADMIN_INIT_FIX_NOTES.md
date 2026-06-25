# Firebase Admin Initialization Fix

This patch fixes the backend crash:

```text
TypeError: Cannot read properties of undefined (reading 'length')
```

The backend previously used the legacy `admin.apps.length` API from `require('firebase-admin')`. In some newer Node/Firebase Admin SDK combinations that shape is not exposed as expected.

The initializer now uses the modular Admin SDK entry points:

```js
require('firebase-admin/app')
require('firebase-admin/firestore')
```

and checks initialized apps with `getApps()`.

Updated files:

```text
server/src/firebase.js
server/src/services/replayStore.js
```

The Firestore timestamp helper now uses `FieldValue.serverTimestamp()` from `firebase-admin/firestore`.
