require "rails_helper"

# The operator's report on one house, on the group payload it rides on.
#
# The spec that matters here is the first one: the plan promises the operator sees "exactly the
# alerts the house admin sees", and the only way that can be true is if the operator is handed
# exactly the data the house's own dashboard hands `collectDashboardWarnings`. So this file does not
# describe the expected shape — it calls the house's four endpoints as a house admin, calls the
# operator's endpoint as the operator, and compares. A serializer that grows a field, or a
# controller that changes an order, moves both sides at once or fails here.
RSpec.describe "GET /api/super_admin/groups/:id report" do
  let(:operator) { "user_01OPERATOR" }
  # Unconfirmed timezone: the first warning, and the one a factory-built house has for free.
  let(:group) { create(:group, name: "Alma Road", timezone: "Europe/London") }

  before { allowlist_super_admins(operator) }

  def operator_headers = workos_headers(sub: operator, org_id: nil)

  # A real, ordinary admin of this house — the caller whose dashboard the operator is mirroring.
  def house_headers = workos_headers(sub: "user_01HOUSE", org_id: group.workos_organization_id)

  def report
    get "/api/super_admin/groups/#{group.id}", headers: operator_headers
    expect(response).to have_http_status(:ok)
    response.parsed_body.fetch("report")
  end

  def house(path)
    get path, headers: house_headers
    expect(response).to have_http_status(:ok)
    response.parsed_body
  end

  it "rides on the group payload rather than on a route of its own" do
    get "/api/super_admin/groups/#{group.id}", headers: operator_headers

    expect(response.parsed_body.keys)
      .to eq(%w[group admins members rotas recent_sms_messages report])
    expect(response.parsed_body.fetch("report").keys)
      .to eq(%w[warnings_input upcoming_shifts weekly admins members spend])
  end

  describe "the warnings input" do
    # Every condition collectDashboardWarnings knows about, at once: an unconfirmed timezone, a
    # calendar that has stopped syncing, a failed text, a rota nobody is on, and somebody active who
    # has opted out. A house with none of them would make this comparison prove nothing.
    let!(:alice) { create(:member, group: group, name: "Alice") }
    let!(:opted_out) { create(:member, :opted_out, group: group, name: "Bowed Out") }
    let!(:draft_rota) { create(:rota, group: group, name: "Zed draft") }

    let!(:running_rota) do
      rota = create(:rota, group: group, name: "Bins")
      create(:rota_position, rota: rota, member: alice, position: 0)
      rota
    end

    before do
      create(:calendar_connection, group: group, consecutive_failures: 4,
        last_error: "The calendar link returned 404.")

      shift = create(:shift, rota: running_rota, assigned_member: alice, due_on: Date.current + 3)
      create(:sms_message, :failed, shift: shift, member: alice, body: "Hi Alice!")
      create(:sms_message, :sent, shift: shift, member: alice, days_before: 0)
    end

    # Fetched once per example, in this order, because reading the house's dashboard provisions its
    # admin — which changes the `admins` table and nothing this comparison looks at.
    let(:house_group) { house("/api/group").fetch("group") }
    let(:house_rotas) { house("/api/rotas").fetch("rotas") }
    let(:house_members) { house("/api/members").fetch("members") }
    let(:house_failed) { house("/api/sms_messages?status=failed&limit=100").fetch("sms_messages") }

    let(:input) { report.fetch("warnings_input") }

    it "sets up a house with something to warn about, or the comparisons below prove nothing" do
      expect(house_group).to include("timezone_confirmed" => false)
      expect(house_group.fetch("calendar")).to include("failing" => true)
      expect(house_rotas.map { |rota| rota.fetch("draft") }).to include(true)
      expect(house_members.map { |member| member.fetch("contactable") }).to include(false)
      expect(house_failed.length).to eq(1)
    end

    it "is the house's own group payload, byte for byte" do
      expect(input.fetch("group")).to eq(house_group)
    end

    it "is the house's own rotas, byte for byte and in the same order" do
      expect(input.fetch("rotas")).to eq(house_rotas)
    end

    # One difference, and exactly one: the magic link. It is a permanent login to somebody else's
    # house and the operator never needs it; every other field the house's own dashboard reads —
    # `active` and `contactable`, which together decide the "won't get texts" warning — is here.
    it "is the house's own members, in the same order, with the magic link taken out" do
      expect(input.fetch("members")).to eq(house_members.map { |member| member.except("access_token") })
    end

    it "drops the access token and nothing else" do
      expect(house_members.first.keys - input.fetch("members").first.keys).to eq([ "access_token" ])
      expect(input.fetch("members").first.keys - house_members.first.keys).to be_empty
    end

    # The house's own failed log, found by the same scope, in the same order, with the one thing the
    # operator must not be shown struck out of the body: every text this product sends carries the
    # recipient's magic link.
    it "is the house's own failed texts, redacted, and otherwise identical" do
      expect(input.fetch("failed_sms").length).to eq(house_failed.length)

      input.fetch("failed_sms").zip(house_failed).each do |operator_row, house_row|
        expect(operator_row.except("body", "member")).to eq(house_row.except("body", "member"))
        # The member reference collectDashboardWarnings counts people by, unchanged — plus the
        # phone number, which the plan shows the operator in full and the house's log does not
        # repeat because the house already knows it.
        expect(operator_row.fetch("member")).to include(house_row.fetch("member"))
      end
    end

    it "carries only the failures, exactly as the house's dashboard asks for them" do
      expect(input.fetch("failed_sms").map { |row| row.fetch("status") }).to eq([ "failed" ])
      expect(input.fetch("failed_sms").map { |row| row.fetch("id") })
        .to eq(house_failed.map { |row| row.fetch("id") })
    end
  end

  # The group page is one house, and an operator opens it straight after doing something to that
  # house. A minute of cached staleness there reads as "the action did nothing".
  it "is not cached — a second read after a change sees the change" do
    create(:member, group: group, name: "Alice")
    expect(report.fetch("members").map { |row| row.fetch("name") }).to eq([ "Alice" ])

    create(:member, group: group, name: "Bob")

    expect(report.fetch("members").map { |row| row.fetch("name") }).to eq([ "Alice", "Bob" ])
  end

  # The report does not grow the page's query count with the size of the house — asserted against
  # the query object itself, in spec/queries/super_admin/group_report_spec.rb, where the per-request
  # query cache is not around to make a preload that happens to repeat an earlier bind look free.
end
