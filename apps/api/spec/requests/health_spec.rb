require "rails_helper"

RSpec.describe "Health check" do
  it "returns 200 once the app has booted" do
    get "/up"

    expect(response).to have_http_status(:ok)
  end
end
