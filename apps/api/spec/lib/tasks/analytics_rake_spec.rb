require "rails_helper"
require "rake"

# The two printers that changed when landing views started carrying a daily visitor code
# (BLO-1701): the funnel task now says how many BROWSERS step 1 came from, and the prune task now
# deletes the codes as well as the events.
#
# The arithmetic itself belongs to AnalyticsReport and to DailyVisitor and is tested there. What is
# here is what an operator actually reads, because both of these have a wrong answer that looks
# exactly like a right one: "0 visitors" under a healthy view count, and a prune that quietly only
# touched one of the two tables.
RSpec.describe "analytics rake tasks" do
  before(:all) do
    Rake.application = Rake::Application.new
    Rails.application.load_tasks
  end

  after(:all) { Rake.application = nil }

  def run_task(name, *args)
    original = $stdout
    $stdout = StringIO.new
    task = Rake::Task[name]
    task.reenable
    task.invoke(*args)
    $stdout.string
  ensure
    $stdout = original
  end

  def view(first_visit_today: nil, at: 1.day.ago)
    properties = first_visit_today.nil? ? {} : { "first_visit_today" => first_visit_today }
    create(:analytics_event, name: AnalyticsEvent::LANDING_VIEW, occurred_at: at, properties: properties)
  end

  describe "analytics:funnel" do
    it "prints the browsers beside the views, and the views each to one decimal" do
      3.times { view(first_visit_today: true) }
      2.times { view(first_visit_today: false) }

      output = run_task("analytics:funnel", "30")

      expect(output).to match(/browsers\s+3\s+1\.7 views each/)
    end

    # Nought browsers against five real views is not "nobody came", it is "nobody was counted": a
    # window older than the visitor code, or a deploy with no ANALYTICS_SHARED_SECRET. A printed
    # "0 visitors" there would be a lie with a number on it.
    it "says nobody was counted rather than printing nought visitors" do
      3.times { view }

      output = run_task("analytics:funnel", "30")

      expect(output).to include("no visitor counted in this window")
      expect(output).not_to match(/browsers\s+0/)
    end
  end

  describe "analytics:prune" do
    it "deletes expired visitor codes as well as expired anonymous events" do
      view(at: 200.days.ago)
      view(at: 1.day.ago)
      DailyVisitor.create!(day: Date.current - 5, digest: "a" * 64)
      DailyVisitor.create!(day: Date.current, digest: "b" * 64)

      output = run_task("analytics:prune")

      expect(output).to include("Pruned 1 anonymous event older than 180 days.")
      expect(output).to include("Pruned 1 daily visitor code: everything before yesterday.")
      expect(AnalyticsEvent.count).to eq(1)
      expect(DailyVisitor.pluck(:day)).to eq([ Date.current ])
    end

    # The days argument is the EVENTS' retention and nothing else. A visitor code is only meaningful
    # on the day it was made, so how long to keep one is not a choice to make at a command line.
    it "keeps the code rule fixed however many days the caller asks for" do
      DailyVisitor.create!(day: Date.current - 5, digest: "a" * 64)

      run_task("analytics:prune", "3650")

      expect(DailyVisitor.count).to be_zero
    end
  end
end
