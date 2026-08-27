---
id: form-data
title: FormData
sidebar_position: 6
---

# FormData

Upload files and form fields using `FormData`.

## File upload example

```ts
import { fetch } from 'react-native-nitro-fetch';

const fd = new FormData();
fd.append('username', 'nitro_user');
fd.append('avatar', {
  uri: 'file:///path/to/photo.jpg',
  type: 'image/jpeg',
  name: 'avatar.jpg',
});

const res = await fetch('https://httpbin.org/post', {
  method: 'POST',
  body: fd,
});
const json = await res.json();
```

## Text fields

```ts
const fd = new FormData();
fd.append('name', 'John');
fd.append('email', 'john@example.com');

const res = await fetch('https://httpbin.org/post', {
  method: 'POST',
  body: fd,
});
```

:::note
The `FormData` API follows the standard browser interface. File objects use the React Native convention with `uri`, `type`, and `name` fields.
:::

Native multipart serialization escapes quotes and line breaks in field names and filenames. Field names and string values normalize line breaks to CRLF; file bytes are unchanged. Repeated fields retain their order. File MIME types containing CR or LF reject the request instead of creating malformed multipart headers. Uploads are still buffered in memory; these encoding rules do not add streaming file uploads.
