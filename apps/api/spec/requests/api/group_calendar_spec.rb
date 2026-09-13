require "rails_helper"

# The admin's four calendar endpoints. Every example here is also asking one more question than it
# looks like it is asking: did the secret stay on the server? The link is a credential (spec section
# 5), so `masked_url` is the only form of it any response may carry, on any path, including errors.
RSpec.describe "Api::GroupCalendar" do
  let(:group) { create(:group, workos_organization_id: "org_01FLAT", timezone: "Europe/London") }
  let!(:alfie) { create(:member, group: group, name: "Alfie") }
  let(:url) { "https://calendar.google.com/calendar/ical/park%40gmail.com/private-abc123def456/basic.ics" }
  # The part of the link that must never be written anywhere. Masking keeps the last four characters
  # ("f456"), so asserting on the whole secret is the assertion that actually means something.
  let(:secret) { "private-abc123def456" }
  let(:masked) { "calendar.google.com/…f456/basic.ics" }
  let(:feed) { file_fixture("ics/google_export.ics").read }
  def headers = workos_headers(org_id: group.workos_organization_id)

  around { |example| travel_to(Time.zone.parse("2026-09-13 12:00:00 UTC")) { example.run } }

  # Connect and "Sync now" both classify inline, so the Claude call is stubbed for the whole file.
  before { stub_claude_for_titles("Alfie in Greece (Song Leader Retreat)" => [ "away", [ alfie.id ], "Alfie, six nights in Greece" ]) }

  describe "PUT /api/group/calendar" do
    it "connects, syncs, and returns the summary and a preview without the link" do
      stub_request(:get, url).to_return(status: 200, body: feed)

      put "/api/group/calendar", params: { ical_url: url }, headers: headers

      expect(response).to have_http_status(:ok)
      body = response.parsed_body
      expect(body["calendar"]).to include(
        "calendar_name" => "Park vista", "masked_url" => masked, "events_count" => 1,
        "unclassified_count" => 0, "failing" => false, "last_error" => nil
      )
      expect(body["calendar"]["last_synced_at"]).to be_present
      expect(body["events_preview"].first).to include(
        "title" => "Alfie in Greece (Song Leader Retreat)", "kind" => "away", "member_ids" => [ alfie.id ],
        "reason" => "Alfie, six nights in Greece", "starts_on" => "2026-09-25", "ends_on" => "2026-10-01",
        "all_day" => true, "start_time" => nil
      )
      expect(response.body).not_to include(secret)
    end

    it "stores the connection it just proved works" do
      stub_request(:get, url).to_return(status: 200, body: feed)

      put "/api/group/calendar", params: { ical_url: url }, headers: headers

      expect(group.reload.calendar_connection).to have_attributes(ical_url: url, disabled_at: nil, consecutive_failures: 0)
    end

    # Spec section 6: saving a new link is a fresh start, and a house that had given up on the old
    # one is syncing again from this request on.
    it "clears a disabled connection when a new link is saved" do
      create(:calendar_connection, group: group, disabled_at: Time.current, consecutive_failures: 7)
      stub_request(:get, url).to_return(status: 200, body: feed)

      put "/api/group/calendar", params: { ical_url: url }, headers: headers

      expect(response).to have_http_status(:ok)
      expect(group.reload.calendar_connection).to have_attributes(ical_url: url, disabled_at: nil, consecutive_failures: 0)
      expect(CalendarConnection.count).to eq(1)
    end

    it "counts the events still waiting for a verdict when Claude was unreachable" do
      stub_request(:get, url).to_return(status: 200, body: feed)
      stub_request(:post, AnthropicStubs::MESSAGES_URL).to_return(status: 401, body: "{}")

      put "/api/group/calendar", params: { ical_url: url }, headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["calendar"]).to include("events_count" => 1, "unclassified_count" => 1, "failing" => false)
      expect(response.parsed_body["events_preview"].first).to include("kind" => "event", "reason" => nil, "member_ids" => [])
    end

    it "rejects a bad link with a field error" do
      put "/api/group/calendar", params: { ical_url: "http://nope" }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to include(
        "error" => "invalid", "code" => "not_https", "fields" => { "ical_url" => [ "Paste the full https link." ] }
      )
      expect(CalendarConnection.count).to eq(0)
    end

    it "rejects a link that is not a calendar feed" do
      stub_request(:get, url).to_return(status: 200, body: file_fixture("ics/not_a_calendar.html").read)

      put "/api/group/calendar", params: { ical_url: url }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to include(
        "code" => "not_a_calendar", "fields" => { "ical_url" => [ "That link isn't a calendar feed." ] }
      )
      expect(response.body).not_to include(secret)
      expect(CalendarConnection.count).to eq(0)
    end

    it "rejects a link Google has stopped answering, without echoing it back" do
      stub_request(:get, url).to_return(status: 404, body: "")

      put "/api/group/calendar", params: { ical_url: url }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body).to include(
        "code" => "gone",
        "fields" => { "ical_url" => [ "Couldn't fetch that link. Check it is the secret iCal address and try again." ] }
      )
      expect(response.body).not_to include(secret)
      expect(CalendarConnection.count).to eq(0)
    end

    it "asks for the link when none was sent" do
      put "/api/group/calendar", params: {}, headers: headers

      expect(response).to have_http_status(:bad_request)
      expect(response.parsed_body).to include("error" => "parameter_missing")
    end

    it "is refused without a token" do
      put "/api/group/calendar", params: { ical_url: url }

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "POST /api/group/calendar/sync" do
    it "syncs the caller's connection only" do
      connection = create(:calendar_connection, group: group, ical_url: url)
      other = create(:calendar_connection)
      stub_request(:get, url).to_return(status: 200, body: feed)

      post "/api/group/calendar/sync", headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["calendar"]).to include("events_count" => 1, "masked_url" => masked)
      expect(response.body).not_to include(secret)
      expect(connection.reload.last_synced_at).to be_present
      expect(other.reload.last_synced_at).to be_nil
      expect(a_request(:get, other.ical_url)).not_to have_been_made
    end

    it "re-enables a disabled connection" do
      create(:calendar_connection, group: group, ical_url: url, disabled_at: Time.current, consecutive_failures: 5)
      stub_request(:get, url).to_return(status: 200, body: feed)

      post "/api/group/calendar/sync", headers: headers

      expect(group.reload.calendar_connection).to have_attributes(disabled_at: nil, consecutive_failures: 0)
    end

    it "reports a failure in plain words rather than raising" do
      create(:calendar_connection, group: group, ical_url: url)
      stub_request(:get, url).to_timeout

      post "/api/group/calendar/sync", headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["calendar"]).to include("last_error" => "Couldn't reach the calendar.", "failing" => false)
      expect(response.body).not_to include(secret)
    end

    it "is 404 when nothing is connected" do
      post "/api/group/calendar/sync", headers: headers

      expect(response).to have_http_status(:not_found)
      expect(response.parsed_body).to eq("error" => "not_found")
    end

    it "is refused without a token" do
      post "/api/group/calendar/sync"

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "GET /api/group/calendar/events" do
    it "lists the next N days for this group" do
      connection = create(:calendar_connection, group: group)
      create(:calendar_event, calendar_connection: connection, summary: "Soon", starts_on: Date.new(2026, 9, 20), ends_on: Date.new(2026, 9, 20))
      create(:calendar_event, calendar_connection: connection, summary: "Later", starts_on: Date.new(2026, 11, 20), ends_on: Date.new(2026, 11, 20))
      create(:calendar_event, calendar_connection: connection, summary: "Gone", starts_on: Date.new(2026, 9, 1), ends_on: Date.new(2026, 9, 2))

      get "/api/group/calendar/events", params: { days: 30 }, headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["events"].map { |event| event["title"] }).to eq([ "Soon" ])
      expect(response.body).not_to include(connection.ical_url)
    end

    it "carries the model's reason, so a wrong verdict can be spotted" do
      connection = create(:calendar_connection, group: group)
      event = create(:calendar_event, calendar_connection: connection, summary: "Alfie in Greece",
                                      kind: "away", reason: "Alfie, six nights in Greece",
                                      starts_on: Date.new(2026, 9, 20), ends_on: Date.new(2026, 9, 22))
      event.members << alfie

      get "/api/group/calendar/events", headers: headers

      expect(response.parsed_body["events"].first).to include(
        "id" => event.id, "kind" => "away", "reason" => "Alfie, six nights in Greece", "member_ids" => [ alfie.id ]
      )
    end

    it "renders a timed event at its wall-clock time in the house's zone" do
      connection = create(:calendar_connection, group: group)
      create(:calendar_event, calendar_connection: connection, summary: "House dinner", all_day: false,
                              starts_on: Date.new(2026, 9, 20), ends_on: Date.new(2026, 9, 20),
                              starts_at: Time.utc(2026, 9, 20, 18, 0), ends_at: Time.utc(2026, 9, 20, 20, 0))

      get "/api/group/calendar/events", headers: headers

      # 18:00 UTC on 20 September is 19:00 in London, which is the time the house wrote down.
      expect(response.parsed_body["events"].first).to include("all_day" => false, "start_time" => "19:00")
    end

    it "never looks further ahead than the stored window" do
      connection = create(:calendar_connection, group: group)
      create(:calendar_event, calendar_connection: connection, summary: "Way out", starts_on: Date.new(2027, 3, 1), ends_on: Date.new(2027, 3, 1))

      get "/api/group/calendar/events", params: { days: 5000 }, headers: headers

      expect(response.parsed_body["events"]).to eq([])
    end

    # `days` is a query parameter, so it is whatever the caller typed. `days[]=1` arrives as an
    # Array, which does not answer to_i at all, and the action used to raise NoMethodError: a 500
    # for a malformed query string on a read-only endpoint.
    it "falls back to the default window when days is not a scalar" do
      connection = create(:calendar_connection, group: group)
      create(:calendar_event, calendar_connection: connection, summary: "Soon", starts_on: Date.new(2026, 9, 20), ends_on: Date.new(2026, 9, 20))
      create(:calendar_event, calendar_connection: connection, summary: "Later", starts_on: Date.new(2026, 11, 20), ends_on: Date.new(2026, 11, 20))

      get "/api/group/calendar/events", params: { days: [ "1" ] }, headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["events"].map { |event| event["title"] }).to eq([ "Soon" ])
    end

    it "falls back to the default window when days is a word" do
      connection = create(:calendar_connection, group: group)
      create(:calendar_event, calendar_connection: connection, summary: "Soon", starts_on: Date.new(2026, 9, 20), ends_on: Date.new(2026, 9, 20))

      get "/api/group/calendar/events", params: { days: "soon" }, headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["events"].map { |event| event["title"] }).to eq([ "Soon" ])
    end

    it "is 404 when nothing is connected" do
      get "/api/group/calendar/events", headers: headers

      expect(response).to have_http_status(:not_found)
    end

    it "is refused without a token" do
      get "/api/group/calendar/events"

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "DELETE /api/group/calendar" do
    it "removes the connection and its events" do
      connection = create(:calendar_connection, group: group)
      create(:calendar_event, calendar_connection: connection)

      delete "/api/group/calendar", headers: headers

      expect(response).to have_http_status(:no_content)
      expect(response.body).not_to include(connection.ical_url)
      expect(CalendarConnection.count).to eq(0)
      expect(CalendarEvent.count).to eq(0)
    end

    it "is 404 when nothing is connected" do
      delete "/api/group/calendar", headers: headers

      expect(response).to have_http_status(:not_found)
    end

    it "is refused without a token" do
      delete "/api/group/calendar"

      expect(response).to have_http_status(:unauthorized)
    end
  end

  # 404, never 403: another house's connection must look exactly like one that never existed.
  describe "one house cannot reach another's calendar" do
    let(:other_group) { create(:group, workos_organization_id: "org_01OTHER", timezone: "Europe/London") }
    let!(:theirs) { create(:calendar_connection, group: other_group, calendar_name: "Someone else's") }

    it "cannot sync it" do
      post "/api/group/calendar/sync", headers: headers

      expect(response).to have_http_status(:not_found)
      expect(theirs.reload.last_synced_at).to be_nil
    end

    it "cannot disconnect it" do
      delete "/api/group/calendar", headers: headers

      expect(response).to have_http_status(:not_found)
      expect(CalendarConnection.exists?(theirs.id)).to be(true)
    end

    it "cannot read its events" do
      create(:calendar_event, calendar_connection: theirs, summary: "Theirs", starts_on: Date.new(2026, 9, 20), ends_on: Date.new(2026, 9, 20))
      mine = create(:calendar_connection, group: group)
      create(:calendar_event, calendar_connection: mine, summary: "Ours", starts_on: Date.new(2026, 9, 20), ends_on: Date.new(2026, 9, 20))

      get "/api/group/calendar/events", headers: headers

      expect(response.parsed_body["events"].map { |event| event["title"] }).to eq([ "Ours" ])
    end
  end

  # Mirrors spec/requests/api/member/token_privacy_spec.rb. The point is not that the log is empty.
  # It is that the request WAS logged, in full, and the secret came out as [FILTERED].
  describe "log redaction" do
    it "writes the request and redacts the link" do
      stub_request(:get, url).to_return(status: 200, body: feed)
      io = StringIO.new
      test_logger = ActiveSupport::Logger.new(io)
      test_logger.level = Logger::DEBUG

      swapped = { rails: Rails.logger, controller: ActionController::Base.logger }
      Rails.logger = test_logger
      ActionController::Base.logger = test_logger
      begin
        put "/api/group/calendar", params: { ical_url: url }, headers: headers
      ensure
        Rails.logger = swapped[:rails]
        ActionController::Base.logger = swapped[:controller]
      end

      expect(response).to have_http_status(:ok)
      expect(io.string).to include("/api/group/calendar")
      expect(io.string).to match(/ical_url.*\[FILTERED\]/)
      expect(io.string).not_to include(secret)
    end

    it "would be redacted wherever the link arrived as a parameter" do
      filter = ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters)

      expect(filter.filter("ical_url" => url)["ical_url"]).to eq("[FILTERED]")
    end
  end

  # Rack::Test normalises a trailing slash out of the path before the app sees it, so the request
  # spec below cannot reach that case even though a real HTTP client can send it. These go straight
  # at the predicate with a raw Rack env, which is the only place the unnormalised path exists.
  describe "which requests the calendar throttle counts" do
    def rack_request(method, path)
      Rack::Attack::Request.new(Rack::MockRequest.env_for(path, method: method))
    end

    it "counts every spelling of a path that reaches the two fetching actions" do
      [
        [ "POST", "/api/group/calendar/sync" ],
        [ "POST", "/api/group/calendar/sync.json" ],
        [ "POST", "/api/group/calendar/sync/" ],
        [ "POST", "/api/group/calendar/sync//" ],
        [ "PUT", "/api/group/calendar" ],
        [ "PUT", "/api/group/calendar.json" ],
        [ "PUT", "/api/group/calendar/" ],
        [ "PATCH", "/api/group/calendar.json" ]
      ].each do |method, path|
        expect(Rack::Attack.calendar_fetch?(rack_request(method, path))).to be(true), "#{method} #{path} was not counted"
      end
    end

    it "leaves alone the reads, the other verbs and the rest of the API" do
      [
        [ "GET", "/api/group/calendar/events" ],
        [ "GET", "/api/group/calendar" ],
        [ "DELETE", "/api/group/calendar" ],
        [ "POST", "/api/group/calendar" ],
        [ "PUT", "/api/group/calendar/sync" ],
        [ "PUT", "/api/group" ],
        [ "POST", "/api/member/shifts" ]
      ].each do |method, path|
        expect(Rack::Attack.calendar_fetch?(rack_request(method, path))).to be(false), "#{method} #{path} was counted"
      end
    end
  end

  # The connect and sync endpoints both fetch a third-party URL on the caller's behalf, which is the
  # one thing on this API worth looping. The test env cache is null (so the throttle never interferes
  # with any other spec); here a real store is swapped in so the limit can be reached.
  describe "throttling" do
    around do |example|
      original = Rack::Attack.cache.store
      Rack::Attack.cache.store = ActiveSupport::Cache::MemoryStore.new
      example.run
    ensure
      Rack::Attack.cache.store = original
      Rack::Attack.reset!
    end

    # One token, minted once and reused: the bucket is keyed on the Authorization header, and a fresh
    # `workos_headers` call would mint a different token and so a different bucket.
    let(:one_admin) { headers }

    before do
      create(:calendar_connection, group: group, ical_url: url)
      stub_request(:get, url).to_return(status: 200, body: feed)
    end

    it "refuses the sixth sync in a minute" do
      5.times do
        post "/api/group/calendar/sync", headers: one_admin
        expect(response).to have_http_status(:ok)
      end

      post "/api/group/calendar/sync", headers: one_admin

      expect(response).to have_http_status(:too_many_requests)
      expect(response.parsed_body).to eq("error" => "too_many_requests")
    end

    # The reason the key is the token and not the IP: two houses on one office or café network share
    # an IP, and one of them syncing must never lock the other out.
    it "does not let one house use up another house's allowance" do
      other_group = create(:group, workos_organization_id: "org_01OTHER", timezone: "Europe/London")
      create(:calendar_connection, group: other_group, ical_url: "https://calendar.google.com/calendar/ical/other/private-zzz999/basic.ics")
      stub_request(:get, "https://calendar.google.com/calendar/ical/other/private-zzz999/basic.ics").to_return(status: 200, body: feed)

      6.times { post "/api/group/calendar/sync", headers: one_admin }
      expect(response).to have_http_status(:too_many_requests)

      post "/api/group/calendar/sync", headers: workos_headers(org_id: other_group.workos_organization_id)

      expect(response).to have_http_status(:ok)
    end

    it "counts connecting against the same allowance" do
      5.times { post "/api/group/calendar/sync", headers: one_admin }

      put "/api/group/calendar", params: { ical_url: url }, headers: one_admin

      expect(response).to have_http_status(:too_many_requests)
    end

    # Rails routes `(.:format)` and a trailing slash to the same action, so a throttle that compared
    # the raw path string would be five characters away from useless: an admin appending `.json`
    # would get unlimited syncs, each one a third-party download and a paid model call.
    it "counts a sync that appends a format suffix" do
      5.times { post "/api/group/calendar/sync", headers: one_admin }

      post "/api/group/calendar/sync.json", headers: one_admin

      expect(response).to have_http_status(:too_many_requests)
    end

    it "counts a sync that carries a trailing slash" do
      5.times { post "/api/group/calendar/sync", headers: one_admin }

      post "/api/group/calendar/sync/", headers: one_admin

      expect(response).to have_http_status(:too_many_requests)
    end

    it "counts a connect that appends a format suffix" do
      5.times { post "/api/group/calendar/sync", headers: one_admin }

      put "/api/group/calendar.json", params: { ical_url: url }, headers: one_admin

      expect(response).to have_http_status(:too_many_requests)
    end

    # The router generates PATCH alongside PUT for a singular resource, so a limit that only knew
    # about PUT would be one verb away from useless.
    it "counts a PATCH to the same path too" do
      5.times { post "/api/group/calendar/sync", headers: one_admin }

      patch "/api/group/calendar", params: { ical_url: url }, headers: one_admin

      expect(response).to have_http_status(:too_many_requests)
    end

    it "leaves the rest of the admin API alone" do
      10.times { get "/api/group", headers: one_admin }

      expect(response).to have_http_status(:ok)
    end
  end
end
