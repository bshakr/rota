require "rails_helper"

# THE test.
#
# This product is about to be opened to strangers' houses. An admin of one house must not be able
# to read or write another house's rota — and must not be able to do it by simply asking, which is
# the interesting case: by naming the other group's id in a param, a header, a body, or anywhere
# else a client can reach. The group comes from a cryptographically signed token and from nowhere
# else, and this file is what says so.
#
# It exercises Api::BaseController through an anonymous subclass rather than a real endpoint,
# because there are no domain endpoints yet (BLO-1047) — and because what is under test is the
# guarantee every future endpoint inherits, not any one of them.
RSpec.describe Api::BaseController, type: :controller do
  controller do
    def index
      render json: { group: Current.group.workos_organization_id, rotas: group_scope(:rotas).pluck(:name) }
    end

    def show
      render json: { rota: group_scope(:rotas).find(params[:id]).name }
    end

    def update
      rota = group_scope(:rotas).find(params[:id])
      rota.update!(name: params[:name])
      render json: { rota: rota.name }
    end

    def destroy
      group_scope(:rotas).find(params[:id]).destroy!
      head :no_content
    end
  end

  before do
    routes.draw do
      get "rotas" => "anonymous#index"
      get "rotas/:id" => "anonymous#show"
      patch "rotas/:id" => "anonymous#update"
      delete "rotas/:id" => "anonymous#destroy"
    end
  end

  let(:alpha) { create(:group, workos_organization_id: "org_01ALPHA", name: "Alpha House") }
  let(:bravo) { create(:group, workos_organization_id: "org_01BRAVO", name: "Bravo House") }
  let!(:alpha_rota) { create(:rota, group: alpha, name: "Alpha bins") }
  let!(:bravo_rota) { create(:rota, group: bravo, name: "Bravo bins") }

  # A real, valid, WorkOS-signed token. Everything below is Alpha's admin — correctly
  # authenticated, and reaching for Bravo's things.
  before { authenticate_as(org_id: alpha.workos_organization_id) }

  def authenticate_as(org_id:, sub: "user_01ALICE", role: "admin")
    request.headers["Authorization"] = "Bearer #{workos_token(sub: sub, org_id: org_id, role: role)}"
  end

  describe "reading" do
    it "sees its own group's records" do
      get :show, params: { id: alpha_rota.id }

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["rota"]).to eq("Alpha bins")
    end

    it "lists only its own group's records" do
      get :index

      expect(response.parsed_body["rotas"]).to contain_exactly("Alpha bins")
    end

    # The headline case: a valid token, and the other group's id passed explicitly.
    it "cannot read another group's record by naming its id" do
      get :show, params: { id: bravo_rota.id }

      expect(response).to have_http_status(:not_found)
    end

    # 404, not 403: a group must not be able to learn that another group's record exists, which
    # is what a 403 would tell it. The response is indistinguishable from an id that never was.
    it "answers a cross-tenant id exactly as it answers an id that never existed" do
      get :show, params: { id: bravo_rota.id }
      cross_tenant = [ response.status, response.body ]

      get :show, params: { id: 0 }

      expect([ response.status, response.body ]).to eq(cross_tenant)
    end
  end

  describe "writing" do
    it "cannot update another group's record by naming its id" do
      patch :update, params: { id: bravo_rota.id, name: "Owned" }

      expect(response).to have_http_status(:not_found)
      expect(bravo_rota.reload.name).to eq("Bravo bins")
    end

    it "cannot destroy another group's record by naming its id" do
      delete :destroy, params: { id: bravo_rota.id }

      expect(response).to have_http_status(:not_found)
      expect { bravo_rota.reload }.not_to raise_error
    end
  end

  # The whole point of the design: org_id is a claim, so nothing the client says about which
  # group it is in can be heard at all. These are the places a client would try to say it.
  describe "the group is never taken from the client" do
    it "ignores a group_id query param" do
      get :index, params: { group_id: bravo.id }

      expect(response.parsed_body).to eq("group" => "org_01ALPHA", "rotas" => [ "Alpha bins" ])
    end

    it "ignores an organization id passed as a param" do
      get :index, params: { org_id: bravo.workos_organization_id, organization_id: bravo.workos_organization_id }

      expect(response.parsed_body["group"]).to eq("org_01ALPHA")
    end

    it "ignores a group id passed as a header" do
      request.headers["X-Group-Id"] = bravo.id.to_s
      request.headers["X-Organization-Id"] = bravo.workos_organization_id

      get :index

      expect(response.parsed_body["group"]).to eq("org_01ALPHA")
    end

    it "scopes to the group the token names, even when a param names another" do
      authenticate_as(org_id: bravo.workos_organization_id, sub: "user_01BOB")

      get :index, params: { group_id: alpha.id }

      expect(response.parsed_body).to eq("group" => "org_01BRAVO", "rotas" => [ "Bravo bins" ])
    end
  end
end
