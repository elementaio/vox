defmodule PochtaWeb.PageController do
  @moduledoc """
  Serves the bundled single-page app so the relay is one self-hostable
  deployable: run it, visit its URL, and it serves the client — which then talks
  back to the same origin. (Assets are served by Plug.Static in the endpoint.)
  """
  use PochtaWeb, :controller

  def index(conn, _params) do
    path = Application.app_dir(:pochta, "priv/static/app/index.html")

    if File.exists?(path) do
      conn
      |> put_resp_content_type("text/html")
      |> send_file(200, path)
    else
      conn
      |> put_resp_content_type("text/html")
      |> send_resp(200, """
      <!doctype html><meta charset="utf-8">
      <h1>🔒 Relay is running</h1>
      <p>The web client isn't bundled into this build. Build it and copy it in:</p>
      <pre>pnpm --filter web build &amp;&amp; \\
        cp -r apps/web/dist apps/server/priv/static/app</pre>
      <p>In development, open the Vite dev server instead.</p>
      """)
    end
  end
end
