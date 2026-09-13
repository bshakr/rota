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
  # Every route mounted under the namespace, as [ :get, "/api/super_admin/..." ].
  def super_admin_routes
    Rails.application.routes.routes.filter_map do |route|
      path = route.path.spec.to_s.delete_suffix("(.:format)")
      next unless path.start_with?("/api/super_admin")

      # Any dynamic segment becomes a placeholder. The gate runs before the action, so nothing
      # here ever has to resolve to a row — which is what keeps this list honest for future
      # routes that take an id.
      [ route.verb.downcase.to_sym, path.gsub(/:[a-z_]+/, "0") ]
    end
  end

  def walk_super_admin_routes(headers)
    routes = super_admin_routes
    expect(routes).to be_present

    routes.each do |verb, path|
      public_send(verb, path, headers: headers)
      yield "#{verb.upcase} #{path}"
    end
  end

  # A real, valid, WorkOS-signed token from an admin of a real house — the credential that gets
  # this caller everything on /api/*. Held in a let so every request in an example presents the
  # same token, rather than minting a fresh one per call.
  # The WorkOS user id this suite treats as the operator's. A let, not a constant: the allowlist
  # is the only thing that makes an id special, and nothing about the id itself is.
  let(:operator) { "user_01OPERATOR" }
  let(:house_admin_headers) { workos_headers(sub: "user_01ALICE", org_id: "org_01FLAT", role: "admin") }
  let(:operator_headers) { workos_headers(sub: operator, org_id: "org_01FLAT", role: "admin") }

  it "walks the routes it thinks it is walking" do
    expect(super_admin_routes).to include([ :get, "/api/super_admin/overview" ])
  end

  # The headline case.
  describe "a valid house admin token whose sub is not on the allowlist" do
    before { allowlist_super_admins(operator) }

    it "is answered 404 on every super admin route" do
      walk_super_admin_routes(house_admin_headers) do |route|
        expect(response).to have_http_status(:not_found), "#{route} did not answer 404"
        expect(response.parsed_body).to eq("error" => "not_found"), "#{route} did not answer not_found"
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

  # Two base controllers, two invariants. Reusing the tenant seam with an escape hatch is the one
  # bug nobody gets to make quietly, so the super admin side never mixes it in at all.
  it "is deliberately not TenantScoped" do
    expect(SuperAdmin::BaseController.ancestors).not_to include(TenantScoped)
  end
end
