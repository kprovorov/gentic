import app from "../src/index"

// Vercel serves this single function for every route (see vercel.json rewrite);
// the Express app does its own routing from the original request URL.
export default app
