require "rails_helper"

# The finding that drove the whole redesign: the member token is a PERMANENT, non-expiring
# credential, and Rails logs `filtered_path` verbatim at info on every request. A token in the URL
# would therefore be written to production logs in plaintext, forever. This file proves it cannot
# regress — the token lives in no Rails path, and a real request carrying it leaves no trace of it in
# the logs.
RSpec.describe "The member token never reaches the logs" do
  it "appears in no member route's path" do
    member_routes = Rails.application.routes.routes.select do |route|
      route.path.spec.to_s.start_with?("/api/member")
    end

    expect(member_routes).not_to be_empty
    member_routes.each do |route|
      expect(route.path.spec.to_s).not_to match(/token/i)
      expect(route.required_parts).not_to include(:token, :access_token)
    end
  end

  it "is redacted from the request log, while the path itself still is not" do
    member = create(:member)
    io = StringIO.new
    test_logger = ActiveSupport::Logger.new(io)
    test_logger.level = Logger::DEBUG

    swapped = { rails: Rails.logger, controller: ActionController::Base.logger }
    Rails.logger = test_logger
    ActionController::Base.logger = test_logger
    begin
      get "/api/member/shifts", headers: { "Authorization" => "Bearer #{member.access_token}" }
    ensure
      Rails.logger = swapped[:rails]
      ActionController::Base.logger = swapped[:controller]
    end

    expect(response).to have_http_status(:ok)
    # The request WAS logged — so the absence of the token below is meaningful, not an empty file.
    expect(io.string).to include("/api/member/shifts")
    expect(io.string).not_to include(member.access_token)
  end

  # Belt to the "keep it out of the path" braces: were a token ever to arrive as a parameter, the
  # existing filter would redact it. This is the filter the bearer header falls inside.
  it "would be redacted if it ever arrived as a parameter" do
    filter = ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters)

    expect(filter.filter("token" => "s3cr3t")["token"]).to eq("[FILTERED]")
    expect(filter.filter("access_token" => "s3cr3t")["access_token"]).to eq("[FILTERED]")
  end
end
