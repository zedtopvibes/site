export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // ======================
    // GET all posts
    // ======================
    if (request.method === "GET" && path === "/posts") {
      const { results } = await env.DB
        .prepare("SELECT title, slug, created_at FROM posts WHERE status='published' ORDER BY created_at DESC")
        .all();

      return Response.json(results, { headers: corsHeaders });
    }

    // ======================
    // GET single post
    // ======================
    if (request.method === "GET" && path.startsWith("/post/")) {
      const slug = path.split("/")[2];
      const { results } = await env.DB
        .prepare("SELECT * FROM posts WHERE slug=? AND status='published'")
        .bind(slug)
        .all();

      if (!results.length) return new Response("Not found", { status: 404 });
      return Response.json(results[0], { headers: corsHeaders });
    }

    // ======================
    // POST admin
    // ======================
    if (request.method === "POST" && path === "/admin/posts") {
      const auth = request.headers.get("Authorization");
      if (auth !== `Bearer ${env.ADMIN_SECRET}`) return new Response("Unauthorized", { status: 401 });

      const body = await request.json();
      await env.DB.prepare(
        "INSERT INTO posts (title, slug, content, cover_image, status) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(body.title, body.slug, body.content, body.cover_image, body.status || "draft")
      .run();

      return Response.json({ success: true }, { headers: corsHeaders });
    }

    return new Response("Not found", { status: 404 });
  }
};
