require "rails_helper"

# The operator's landing page (BLO-1677). SuperAdmin::Overview owns every figure and is tested
# exhaustively in spec/queries/super_admin/overview_spec.rb; this covers what the ENDPOINT adds —
# that the payload reaches an allowlisted operator in one piece, carries the group ids the web page
# navigates by, and still changes nothing.
RSpec.describe "GET /api/super_admin/overview" do
  before { allowlist_super_admins("user_01OPERATOR") }

  def get_overview
    get "/api/super_admin/overview", headers: workos_headers(sub: "user_01OPERATOR")
  end

  it "answers the whole dashboard payload to an allowlisted operator" do
    get_overview

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.keys)
      .to contain_exactly("generated_at", "kpis", "attention", "recent_houses", "system_health", "spend")
  end

  it "carries the KPI tiles, with rates at one decimal" do
    group = create(:group, timezone_confirmed_at: 1.day.ago)
    shift = create(:shift, rota: create(:rota, group: group))
    create(:sms_message, shift: shift, status: "delivered", days_before: 0)
    create(:sms_message, shift: shift, status: "failed", days_before: 1)

    get_overview

    expect(response.parsed_body["kpis"]).to include(
      "houses_total" => 1,
      "texts_last_7_days" => 2,
      "delivery_rate_last_7_days" => 50.0
    )
  end

  # The web page links every row to /super-admin/groups/<id>, so the id is part of the contract.
  it "names every house it lists by id, so the page can link to it" do
    group = create(:group, name: "Alma Road", timezone_confirmed_at: nil, created_at: 10.days.ago)

    get_overview

    body = response.parsed_body
    expect(body["recent_houses"].sole).to include("group_id" => group.id, "name" => "Alma Road")
    expect(body["attention"].sole).to include("group_id" => group.id, "reason" => "unconfirmed_timezone")
  end

  it "reports the health of every recurring job, and the queue's failures" do
    create(:job_run, name: "reminder_sweep", finished_at: 1.hour.ago)

    get_overview

    health = response.parsed_body["system_health"]
    expect(health["jobs"].map { |job| job["name"] })
      .to eq(%w[reminder_sweep top_up_shift_windows calendar_sync])
    expect(health["jobs"].first["last_finished_at"]).to be_present
    expect(health["queue_failed_executions"]).to eq(0)
  end

  # Spend is https://linear.app/bloombase/issue/BLO-1683. The key ships null so the page can render
  # the tile's empty state now rather than growing a key later.
  it "carries a null spend tile" do
    get_overview

    expect(response.parsed_body).to have_key("spend")
    expect(response.parsed_body["spend"]).to be_nil
  end

  it "writes nothing: reading across every house provisions nobody" do
    create(:group)

    writes = sql_writes_during { get_overview }

    expect(response).to have_http_status(:ok)
    expect(writes).to be_empty
  end
end
