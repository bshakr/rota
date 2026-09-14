require "rails_helper"

# The super admin boundary, and the only thing standing in it: an env allowlist of WorkOS user ids.
#
# Everything under /api/super_admin reads across every house in the database on purpose, so the
# question this file answers is the one that matters — who is let in. A correctly authenticated
# house admin is exactly the caller who must be refused, and refused with a 404, so the whole area
# looks to them like a surface that does not exist.
#
# The routes are discovered from the router rather than listed by hand. A later ticket that adds
# `/api/super_admin/groups` inherits this spec without editing it, and cannot add a route that
# nobody checked the allowlist on.
RSpec.describe "Super admin authorization" do
  # Every route mounted under the namespace, as [ :get, "/api/super_admin/..." ] pairs ready to
  # request. A route that names no verb (`match via: :all`) answers all of them, so it is walked
  # with all of them rather than being skipped or turned into `public_send(:"")`.
  def super_admin_routes
    Rails.application.routes.routes.flat_map do |route|
      path = route.path.spec.to_s.delete_suffix("(.:format)")
      next [] unless path.start_with?("/api/super_admin")

      verbs = route.verb.presence ? [ route.verb.downcase.to_sym ] : every_http_verb
      verbs.map { |verb| [ verb, walkable(path) ] }
    end
  end

  def every_http_verb
    %i[get post put patch delete]
  end

  # Dynamic segments become a placeholder: `:id`, and a `*glob` the same way. The gate runs before
  # the action, so nothing here ever has to resolve to a row — which is what keeps this honest for
  # the routes later tickets add.
  def walkable(path)
    path.gsub(/[:*][a-z_]+/, "0")
  end

  def walk_super_admin_routes(headers)
    routes = super_admin_routes
    expect(routes).to be_present

    routes.each do |verb, path|
      route = "#{verb.upcase} #{path}"

      # Named failures, because the ticket that trips these will be one that added a route, not
      # one that touched this file.
      raise "#{route}: this spec left a segment it could not fill in" if path.match?(/[:*]/)
      raise "#{route}: no request helper for #{verb.inspect}" unless respond_to?(verb)

      public_send(verb, path, headers: headers)
      yield route
    end
  end

  # The WorkOS user id this suite treats as the operator's. A let, not a constant: the allowlist is
  # the only thing that makes an id special, and nothing about the id itself is.
  let(:operator) { "user_01OPERATOR" }

  # A real, valid, WorkOS-signed token from an admin of a real house — the credential that gets this
  # caller everything on /api/*. Held in a let so every request in an example presents the same
  # token, rather than minting a fresh one per call.
  let(:house_admin_headers) { workos_headers(sub: "user_01ALICE", org_id: "org_01FLAT", role: "admin") }
  let(:operator_headers) { workos_headers(sub: operator, org_id: "org_01FLAT", role: "admin") }

  it "walks the routes it thinks it is walking" do
    expect(super_admin_routes).to include(
      [ :get, "/api/super_admin/overview" ],
      # The routes that WRITE (BLO-1675). They matter most here: every other route in this namespace
      # would merely leak if the gate were missed, while these would let a house admin who guessed
      # the path rename or pause somebody else's house. An id of 0 names nothing, so a 404 from any
      # of them is the gate answering before a lookup ever happened — which the "changes no row"
      # example below turns into a promise about the whole namespace.
      [ :patch, "/api/super_admin/groups/0" ],
      [ :put, "/api/super_admin/groups/0" ],
      [ :post, "/api/super_admin/groups/0/suspend" ],
      [ :delete, "/api/super_admin/groups/0/suspend" ]
    )
  end

  # The headline case.
  describe "a valid house admin token whose sub is not on the allowlist" do
    before { allowlist_super_admins(operator) }

    it "is answered 404 on every super admin route" do
      walk_super_admin_routes(house_admin_headers) do |route|
        expect(response).to have_http_status(:not_found), "#{route} did not answer 404"
      end
    end

    # Refusing after writing something would make the boundary a way to provision rows in every
    # house in the database. Nothing on a refused request may touch a row — not the just-in-time
    # provisioning the house path does, not anything.
    it "changes no row" do
      writes = sql_writes_during do
        walk_super_admin_routes(house_admin_headers) { nil }
      end

      expect(writes).to be_empty
    end

    it "is still an admin of its own house" do
      get "/api/me", headers: house_admin_headers

      expect(response).to have_http_status(:ok)
    end
  end

  describe "an allowlisted sub" do
    before { allowlist_super_admins(operator) }

    it "is let in" do
      get "/api/super_admin/overview", headers: operator_headers

      expect(response).to have_http_status(:ok)
    end
  end

  # Unset means nobody, in every environment. The deploy that ships this area is inert until
  # somebody sets the variable, so an operator account is never granted by accident.
  describe "an unset allowlist" do
    before { allowlist_super_admins }

    it "answers 404 to everyone, on every route" do
      [ operator_headers, house_admin_headers ].each do |headers|
        walk_super_admin_routes(headers) do |route|
          expect(response).to have_http_status(:not_found), "#{route} did not answer 404"
        end
      end
    end
  end

  # A super admin may have no house at all, so their token may carry no org_id — which is exactly
  # the token the rest of the API refuses, and must go on refusing.
  describe "a token that names no organization" do
    before { allowlist_super_admins(operator) }

    let(:org_less_headers) { workos_headers(sub: operator, org_id: nil) }

    it "is accepted on a super admin route" do
      get "/api/super_admin/overview", headers: org_less_headers

      expect(response).to have_http_status(:ok)
    end

    it "is still refused on /api/me" do
      get "/api/me", headers: org_less_headers

      expect(response).to have_http_status(:unauthorized)
    end

    it "is refused on a super admin route when it is not allowlisted" do
      get "/api/super_admin/overview", headers: workos_headers(sub: "user_01ALICE", org_id: nil)

      expect(response).to have_http_status(:not_found)
    end
  end

  # Authentication and authorization answer differently on purpose. A token that does not verify
  # is 401 here exactly as it is everywhere else on the API, because that is what tells the web app
  # to refresh an expired session; only a caller whose token IS good and who is not on the
  # allowlist gets the 404 that hides the surface.
  describe "a token that does not verify" do
    before { allowlist_super_admins(operator) }

    it "is refused with 401, not 404" do
      get "/api/super_admin/overview", headers: workos_headers(sub: operator, key: WorkosAuth.foreign_key)

      expect(response).to have_http_status(:unauthorized)
    end

    it "is refused with 401 when there is no token at all" do
      get "/api/super_admin/overview"

      expect(response).to have_http_status(:unauthorized)
    end
  end

  # A 404 that does not look exactly like Rails' own would be the tell: answer the app's
  # `{"error":"not_found"}` here and a house admin who probes the path learns that something is
  # listening, even though they cannot use it. So the refusal is not our 404 at all — it is the one
  # ActionDispatch::PublicExceptions serves for a path that does not route, which is what production
  # returns (consider_all_requests_local is false there, and there is no public/404.html).
  describe "the refusal, compared with a path that really does not exist" do
    # Test boots with consider_all_requests_local on, so an unrouted path would raise in-process
    # instead of being rendered. These two headers are what production has set, and they make the
    # real middleware answer the way production answers.
    around do |example|
      env = Rails.application.env_config
      original = env.values_at("action_dispatch.show_detailed_exceptions", "action_dispatch.show_exceptions")
      env["action_dispatch.show_detailed_exceptions"] = false
      env["action_dispatch.show_exceptions"] = :all
      example.run
      env["action_dispatch.show_detailed_exceptions"], env["action_dispatch.show_exceptions"] = original
    end

    before { allowlist_super_admins(operator) }

    def response_signature
      [ response.status, response.headers["Content-Type"], response.body ]
    end

    # Every Accept the prober might send, because matching on only the JSON one would leave the
    # difference visible to a plain curl.
    [ { "Accept" => "application/json" }, {}, { "Accept" => "*/*" } ].each do |accept|
      it "is indistinguishable from an unrouted path, asked for as #{accept.fetch('Accept', 'no Accept header')}" do
        get "/api/super_admin/overview", headers: house_admin_headers.merge(accept)
        refused = response_signature

        get "/api/super_admin/does-not-exist", headers: house_admin_headers.merge(accept)

        expect(refused).to eq(response_signature)
      end
    end

    # Pinned literally as well as by comparison, so a Rails upgrade that changes the shape is a
    # failure here rather than a silent divergence between the two 404s.
    it "answers what Rails answers: a status and a reason, and nothing about an allowlist" do
      get "/api/super_admin/overview", headers: house_admin_headers.merge("Accept" => "application/json")

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body).to eq("status" => 404, "error" => "Not Found")
    end
  end

  # Two base controllers, two invariants. Reusing the tenant seam with an escape hatch is the one
  # bug nobody gets to make quietly, so the super admin side never mixes it in at all.
  it "is deliberately not TenantScoped" do
    expect(SuperAdmin::BaseController.ancestors).not_to include(TenantScoped)
  end
end
