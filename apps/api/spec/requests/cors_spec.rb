require "rails_helper"

RSpec.describe "CORS" do
  # Whatever APP_URL / CORS_ORIGINS resolved to at boot. Defaults to the Next.js dev server.
  let(:web_origin) { Rails.application.config.x.cors_origins.first }

  it "lets the web app read a response" do
    get "/up", headers: { "Origin" => web_origin }

    expect(response.headers["Access-Control-Allow-Origin"]).to eq(web_origin)
  end

  it "answers the preflight for a bearer-authenticated request" do
    process :options, "/up", headers: {
      "Origin" => web_origin,
      "Access-Control-Request-Method" => "POST",
      "Access-Control-Request-Headers" => "Authorization,Content-Type"
    }

    expect(response.headers["Access-Control-Allow-Methods"]).to include("POST")
    expect(response.headers["Access-Control-Allow-Headers"]).to include("Authorization")
  end

  it "refuses an origin that is not configured" do
    get "/up", headers: { "Origin" => "https://not-our-app.example" }

    expect(response.headers["Access-Control-Allow-Origin"]).to be_nil
  end
end
