import { callback } from '../../../lib/cms-auth.mjs';
export const onRequest = ({ request, env }) => callback(request, env);
