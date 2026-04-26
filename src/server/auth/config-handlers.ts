// Splitting handlers from config so the App Router route file stays a one-liner.
import { handlers } from './config';
export const { GET, POST } = handlers;
