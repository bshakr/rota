require "rails_helper"

# What every super admin controller inherits, exercised through an anonymous subclass rather than
# through the one endpoint that happens to exist — the same way spec/controllers/tenant_scoped_spec
# exercises the house side. What is under test is the guarantee, not any one route.
RSpec.describe SuperAdmin::BaseController, type: :controller do
  controller do
    def index
      render json: { operator: Current.super_admin_workos_user_id, group: Current.group_admin }
    end
  end

  before do
    routes.draw { get "overview" => "anonymous#index" }
    allowlist_super_admins("user_01OPERATOR")
  end

  def authenticate_as(sub:, org_id: "org_01FLAT")
    request.headers["Authorization"] = "Bearer #{workos_token(sub: sub, org_id: org_id)}"
  end

  # Every action a super admin takes is taken across houses, so the audit lines the later tickets
  # write have to be able to name the human who took it. The sub is the only durable name there is.
  it "names the operator in Current, for the audit lines later tickets write" do
    authenticate_as(sub: "user_01OPERATOR")

    get :index

    expect(response.parsed_body["operator"]).to eq("user_01OPERATOR")
  end

  # The operator is not acting as an admin of any house, not even one they happen to belong to.
  # Nothing here may inherit a tenant, because there is no tenant to inherit.
  it "puts no house admin in Current" do
    authenticate_as(sub: "user_01OPERATOR")

    get :index

    expect(response.parsed_body["group"]).to be_nil
  end

  it "refuses a caller who is not allowlisted before the action runs" do
    authenticate_as(sub: "user_01ALICE")

    get :index

    expect(response).to have_http_status(:not_found)
    expect(response.parsed_body).to eq("error" => "not_found")
  end
end
