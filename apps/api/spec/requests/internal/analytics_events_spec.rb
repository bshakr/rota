require "rails_helper"

# The one write path into the events table from outside this process. Everything here is really
# asking the same question: can somebody who is not our web app put a row in this table?
RSpec.describe "POST /internal/analytics/events" do
  let(:secret) { "analytics-shared-secret-for-the-suite" }

  def post_event(params, header: secret)
    headers = header.nil? ? {} : { "X-Analytics-Secret" => header }
    post "/internal/analytics/events", params: params, headers: headers, as: :json
  end

  context "with a secret configured" do
    before { allow(Rails.configuration.x.analytics).to receive(:shared_secret).and_return(secret) }

    it "records an anonymous event" do
      post_event({ name: "cta_click", properties: { position: "hero" } })

      expect(response).to have_http_status(:no_content)
      expect(AnalyticsEvent.sole).to have_attributes(
        name: "cta_click", group_id: nil, properties: { "position" => "hero" }
      )
    end

    it "keeps only allowlisted properties" do
      post_event({ name: "landing_view", properties: { utm_source: "reddit", gclid: "abc", secret: "x" } })

      expect(AnalyticsEvent.sole.properties).to eq("utm_source" => "reddit")
    end

    # The web route derives these two from request headers rather than from the body, so they reach
    # this endpoint from a server rather than from a browser. They still go through the model's own
    # per-key check on arrival: this side knows what a REQUEST may contain and the model knows what a
    # ROW may contain, and the day those disagree should be a dropped property, not a stored surprise.
    it "takes the referrer host, country and device class the web app derived" do
      post_event({
        name: "landing_view",
        properties: { referrer_host: "news.ycombinator.com", country: "GB", device: "mobile" }
      })

      expect(response).to have_http_status(:no_content)
      expect(AnalyticsEvent.sole.properties)
        .to eq("referrer_host" => "news.ycombinator.com", "country" => "GB", "device" => "mobile")
    end

    it "keeps the event and drops a visit property whose shape is wrong" do
      post_event({
        name: "landing_view",
        properties: { referrer_host: "https://reddit.com/r/uk?q=secret", country: "XX", device: "fridge" }
      })

      expect(response).to have_http_status(:no_content)
      expect(AnalyticsEvent.sole.properties).to eq({})
    end

    # The boundary this endpoint exists to hold. A browser can reach the Next handler that forwards
    # here, so if `first_text_delivered` were accepted then anybody could post the number the entire
    # funnel exists to measure.
    it "refuses every event that belongs to a house" do
      AnalyticsEvent::GROUP_NAMES.each do |name|
        post_event({ name: name })

        expect(response).to have_http_status(:unprocessable_content), "#{name} was accepted"
      end

      expect(AnalyticsEvent.count).to be_zero
    end

    it "refuses a name that is not on the allowlist at all" do
      post_event({ name: "drop table" })

      expect(response).to have_http_status(:unprocessable_content)
      expect(AnalyticsEvent.count).to be_zero
    end

    it "refuses a wrong secret, and a missing one" do
      post_event({ name: "landing_view" }, header: "wrong-secret")
      expect(response).to have_http_status(:forbidden)

      post_event({ name: "landing_view" }, header: nil)
      expect(response).to have_http_status(:forbidden)

      expect(AnalyticsEvent.count).to be_zero
    end

    it "takes a name with no properties at all" do
      post_event({ name: "signin_completed" })

      expect(response).to have_http_status(:no_content)
      expect(AnalyticsEvent.sole.properties).to eq({})
    end

    it "ignores a properties value that is not an object" do
      post_event({ name: "landing_view", properties: "utm_source=reddit" })

      expect(response).to have_http_status(:no_content)
      expect(AnalyticsEvent.sole.properties).to eq({})
    end
  end

  # An unconfigured deploy should look like it has no such endpoint, rather than like it has one
  # worth guessing at.
  context "with no secret configured" do
    before { allow(Rails.configuration.x.analytics).to receive(:shared_secret).and_return(nil) }

    it "answers 404 to every caller, secret or not" do
      post_event({ name: "landing_view" }, header: "anything")
      expect(response).to have_http_status(:not_found)

      post_event({ name: "landing_view" }, header: nil)
      expect(response).to have_http_status(:not_found)

      expect(AnalyticsEvent.count).to be_zero
    end
  end

  # The suite's real state, and CI's: no ANALYTICS_SHARED_SECRET in the environment, so no open write
  # path into the table.
  it "is closed by default" do
    expect(Rails.configuration.x.analytics.shared_secret).to be_nil
  end
end
