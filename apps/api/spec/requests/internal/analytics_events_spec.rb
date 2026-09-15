require "rails_helper"

# The one write path into the events table from outside this process. Everything here is really
# asking the same question: can somebody who is not our web app put a row in this table?
RSpec.describe "POST /internal/analytics/events" do
  let(:secret) { "analytics-shared-secret-for-the-suite" }

  def post_event(params, header: secret, visitor: nil)
    headers = header.nil? ? {} : { "X-Analytics-Secret" => header }
    headers["X-Analytics-Visitor"] = visitor if visitor
    post "/internal/analytics/events", params: params, headers: headers, as: :json
  end

  # Sixty-four characters of hex, as the web app sends them.
  def code(letter = "a")
    letter * 64
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

    # The web route derives five of these from request headers rather than from the body, so they
    # reach this endpoint from a server rather than from a browser. They still go through the model's
    # own per-key check on arrival: this side knows what a REQUEST may contain and the model knows
    # what a ROW may contain, and the day those disagree should be a dropped property, not a stored
    # surprise.
    it "takes the visit properties the web app derived" do
      post_event({
        name: "landing_view",
        properties: {
          referrer_host: "news.ycombinator.com", country: "GB", city: "London",
          device: "mobile", browser: "safari", os: "ios"
        }
      })

      expect(response).to have_http_status(:no_content)
      expect(AnalyticsEvent.sole.properties).to eq(
        "referrer_host" => "news.ycombinator.com", "country" => "GB", "city" => "London",
        "device" => "mobile", "browser" => "safari", "os" => "ios"
      )
    end

    it "keeps the event and drops a visit property whose shape is wrong" do
      post_event({
        name: "landing_view",
        properties: {
          referrer_host: "https://reddit.com/r/uk?q=secret", country: "XX", city: "51.5,-0.1",
          device: "fridge", browser: "Chrome 141", os: "macOS"
        }
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

    # How this site counts VISITORS without a cookie. The code is hashed by the web app from the
    # visit's address and agent with a salt that changes at midnight; everything below is about the
    # one boolean it turns into, and about the code never reaching a row.
    describe "the daily visitor code" do
      it "marks the first landing view a browser sends today, and not the second" do
        post_event({ name: "landing_view" }, visitor: code)
        post_event({ name: "landing_view" }, visitor: code)

        expect(AnalyticsEvent.order(:id).pluck(:properties))
          .to eq([ { "first_visit_today" => true }, { "first_visit_today" => false } ])
        expect(DailyVisitor.count).to eq(1)
      end

      it "marks a second browser on the same day as new too" do
        post_event({ name: "landing_view" }, visitor: code("a"))
        post_event({ name: "landing_view" }, visitor: code("b"))

        expect(AnalyticsEvent.pluck(:properties)).to all(eq("first_visit_today" => true))
      end

      # The salt changes at midnight, so tomorrow's code for this browser is a different string and
      # there is nothing left that could match the two. No returning-visitor figure can be built out
      # of this table, today or later.
      it "marks the same browser new again the next day" do
        travel_to(Time.utc(2026, 9, 15, 12, 0, 0)) { post_event({ name: "landing_view" }, visitor: code) }
        travel_to(Time.utc(2026, 9, 16, 12, 0, 0)) { post_event({ name: "landing_view" }, visitor: code) }

        expect(AnalyticsEvent.pluck(:properties)).to all(eq("first_visit_today" => true))
        expect(DailyVisitor.count).to eq(2)
      end

      # ABSENT, not false. A visit nobody counted is a different fact from a visit by a browser that
      # had already been here, and the traffic page reads the two differently.
      it "leaves the property off a landing view that carried no code" do
        post_event({ name: "landing_view", properties: { path: "/" } })

        expect(AnalyticsEvent.sole.properties).to eq("path" => "/")
        expect(DailyVisitor.count).to be_zero
      end

      it "leaves the property off, and keeps the visit, when the code is not a code" do
        [ "not-a-digest", code[0, 63], code.upcase, "g" * 64 ].each do |bad|
          post_event({ name: "landing_view" }, visitor: bad)

          expect(AnalyticsEvent.last.properties).to eq({}), bad.inspect
        end

        expect(DailyVisitor.count).to be_zero
      end

      # A cta_click happens on a page whose visit was already counted. Giving it a code would put
      # the same identifier on three rows of one visit, which is the join this table exists not to
      # have — so the endpoint refuses to read one, whatever the caller sends.
      it "ignores a code on any event but a landing view" do
        %w[cta_click signin_started signin_completed].each do |name|
          post_event({ name: name }, visitor: code)

          expect(AnalyticsEvent.last.properties).to eq({}), name
        end

        expect(DailyVisitor.count).to be_zero
      end

      # The property is off SENT_PROPERTY_KEYS, so a caller cannot add a thousand visitors to the
      # traffic page without sending a thousand visits.
      it "refuses a first_visit_today the caller put in the body" do
        post_event({ name: "landing_view", properties: { first_visit_today: true, path: "/" } })

        expect(AnalyticsEvent.sole.properties).to eq("path" => "/")
      end

      it "overrules a first_visit_today in the body with what the code actually says" do
        post_event({ name: "landing_view" }, visitor: code)
        post_event({ name: "landing_view", properties: { first_visit_today: true } }, visitor: code)

        expect(AnalyticsEvent.order(:id).last.properties).to eq("first_visit_today" => false)
      end

      # The invariant the privacy page rests on: the code is read, answered and dropped. It is on
      # the request and it is in daily_visitors; it is in no event, ever.
      it "never writes the code itself into an event" do
        post_event({ name: "landing_view", properties: { path: "/" } }, visitor: code)

        expect(AnalyticsEvent.sole.properties.to_json).not_to include(code)
        expect(DailyVisitor.sole.digest).to eq(code)
      end
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
