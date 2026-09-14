require "rails_helper"
require "rake"

# The one-off that fixes the rows that already exist (https://linear.app/bloombase/issue/BLO-1696).
#
# It is run by hand against production through `railway ssh`, which is the whole reason it takes no
# arguments — and the reason the examples below care as much about what it REFUSES to do as about
# what it writes. WebMock blocks the network, so a run that reached the real WorkOS would fail here.
RSpec.describe "users:refresh_from_workos" do
  before(:all) do
    Rake.application = Rake::Application.new
    Rails.application.load_tasks
  end

  after(:all) { Rake.application = nil }

  let(:task) { Rake::Task["users:refresh_from_workos"] }

  around do |example|
    original = Rails.application.config.x.workos.api_key
    Rails.application.config.x.workos.api_key = "sk_test_directory"
    example.run
    Rails.application.config.x.workos.api_key = original
  end

  # The task prints a line per row, which is the point of it when an operator is watching it walk
  # production — but not something the suite needs to read.
  def run_task
    original_out = $stdout
    original_err = $stderr
    $stdout = StringIO.new
    $stderr = StringIO.new
    task.reenable
    task.invoke
    $stdout.string
  ensure
    $stdout = original_out
    $stderr = original_err
  end

  def stub_workos_user(workos_user_id, status: 200, **attributes)
    stub_request(:get, "https://api.workos.com/user_management/users/#{workos_user_id}")
      .to_return(
        status: status,
        body: { object: "user", id: workos_user_id, **attributes }.to_json,
        headers: { "Content-Type" => "application/json" }
      )
  end

  def placeholder_user(workos_user_id, **attributes)
    create(:user, workos_user_id: workos_user_id, email: User.placeholder_email(workos_user_id), **attributes)
  end

  it "fills a placeholder address and a missing name from WorkOS" do
    user = placeholder_user("user_01ALICE", name: nil)
    stub_workos_user("user_01ALICE", email: "alice@example.com", first_name: "Alice", last_name: "Nkemdirim")

    run_task

    expect(user.reload).to have_attributes(email: "alice@example.com", name: "Alice Nkemdirim")
  end

  # It is run over `railway ssh` against production, so whatever it prints lands in an operator's
  # scrollback and in whatever their terminal keeps. It names the row, never the person in it.
  it "reports the row it filled without printing what it filled it with" do
    user = placeholder_user("user_01ALICE", name: nil)
    stub_workos_user("user_01ALICE", email: "alice@example.com", first_name: "Alice", last_name: "Nkemdirim")

    output = run_task

    expect(output).to include("user #{user.id} (user_01ALICE): filled.")
    expect(output).not_to include("alice@example.com")
    expect(output).not_to include("Alice Nkemdirim")
  end

  # The steady state after one run. An operator who runs it twice — or who runs it again next month
  # for the next admin — must not be writing over what the first run settled.
  it "writes nothing on a second run" do
    user = placeholder_user("user_01ALICE", name: nil)
    stub_workos_user("user_01ALICE", email: "alice@example.com", first_name: "Alice")
    run_task
    settled = user.reload.updated_at

    run_task

    expect(user.reload.updated_at).to eq(settled)
  end

  it "leaves alone the users WorkOS has already told us about" do
    complete = create(:user, workos_user_id: "user_01BOB", email: "bob@example.com", name: "Bob Adeyemi")

    run_task

    expect(complete.reload).to have_attributes(email: "bob@example.com", name: "Bob Adeyemi")
    expect(a_request(:get, %r{/user_management/users/user_01BOB})).not_to have_been_made
  end

  # A user deleted in WorkOS keeps its row here for the foreign keys, and the task has to walk past
  # it rather than stop on it.
  it "carries on past a user WorkOS has never heard of" do
    placeholder_user("user_01GONE", name: nil)
    survivor = placeholder_user("user_01ALICE", name: nil)
    stub_workos_user("user_01GONE", status: 404, message: "User not found")
    stub_workos_user("user_01ALICE", email: "alice@example.com")

    run_task

    expect(survivor.reload.email).to eq("alice@example.com")
  end

  # One row WorkOS cannot answer for must not cost the operator the other nine.
  it "carries on past a user WorkOS refused to answer for" do
    placeholder_user("user_01REFUSED", name: nil)
    survivor = placeholder_user("user_01ALICE", name: nil)
    stub_workos_user("user_01REFUSED", status: 403, message: "not allowed")
    stub_workos_user("user_01ALICE", email: "alice@example.com")

    output = run_task

    expect(survivor.reload.email).to eq("alice@example.com")
    expect(output).to include("failed 1")
  end

  describe "with no API key" do
    around do |example|
      original = Rails.application.config.x.workos.api_key
      Rails.application.config.x.workos.api_key = nil
      example.run
      Rails.application.config.x.workos.api_key = original
    end

    # Never an empty success: an operator who ran this against a service that has no key must be
    # told so, not shown "Filled 0" and left believing WorkOS had nothing to add.
    it "refuses to run rather than reporting that it found nothing" do
      placeholder_user("user_01ALICE", name: nil)

      expect { run_task }.to raise_error(SystemExit)
    end
  end
end
