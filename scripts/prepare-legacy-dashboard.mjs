import { publishLegacy } from '../src/dashboard/legacy-publish.mjs';
console.log(JSON.stringify(await publishLegacy(), null, 2));
