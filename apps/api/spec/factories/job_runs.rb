FactoryBot.define do
  factory :job_run do
    name { JobRun::REMINDER_SWEEP }
    started_at { 2.minutes.ago }
    finished_at { 1.minute.ago }
    succeeded { true }

    # What an hour of a job raising every time looks like on the health tile.
    trait :failed do
      succeeded { false }
      error_class { "ActiveRecord::StatementInvalid" }
    end
  end
end
