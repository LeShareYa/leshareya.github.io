import { auth } from '../../../lib/cms-auth.mjs';
export const onRequest = ({ request, env }) => auth(request, env);
