defmodule PochtaWeb.Router do
  use PochtaWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  # Content-blind encrypted media blobs (ciphertext in/out).
  pipeline :blobs do
    plug :accepts, ["json", "octet-stream", "multipart"]
  end

  pipeline :spa do
    plug :accepts, ["html"]
  end

  # Serve the bundled web client (self-hosted single deployable).
  scope "/", PochtaWeb do
    pipe_through :spa
    get "/", PageController, :index
  end

  scope "/", PochtaWeb do
    pipe_through :blobs
    post "/blobs", BlobController, :upload
    get "/blobs/:id", BlobController, :download
  end

  # Public runtime config (ICE servers) for clients.
  scope "/", PochtaWeb do
    pipe_through :api
    get "/config", ConfigController, :show
  end

  # Relay-to-relay federation.
  scope "/", PochtaWeb do
    pipe_through :api
    get "/federation/identity", FederationController, :identity
    post "/federation/push", FederationController, :push
  end

  # Guarded membership (private relays).
  scope "/", PochtaWeb do
    pipe_through :api
    post "/enroll", MembershipController, :enroll
    post "/admin/enroll_token", MembershipController, :create_token
  end

  # Admin JSON API (behind the /admin web panel; Bearer ADMIN_TOKEN).
  scope "/admin", PochtaWeb do
    pipe_through :api
    get "/members", AdminController, :members
    post "/members", AdminController, :add_member
    post "/members/remove", AdminController, :remove_member
    get "/tokens", AdminController, :tokens
    post "/tokens", AdminController, :mint
    get "/peers", AdminController, :peers
    post "/peers/allow", AdminController, :allow_peer
    post "/peers/revoke", AdminController, :revoke_peer
    get "/audit", AdminController, :audit_log
  end

  # Serve the SPA at /admin too (the panel is a route in the web client).
  scope "/", PochtaWeb do
    pipe_through :spa
    get "/admin", PageController, :index
  end

  scope "/api", PochtaWeb do
    pipe_through :api
  end
end
