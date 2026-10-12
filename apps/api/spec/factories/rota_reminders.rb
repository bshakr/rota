FactoryBot.define do
  factory :rota_reminder do
    rota
    days_before { 0 }
    message_template { "Hi {{name}}! It's your turn for {{rota}} on {{date}} ({{days_until}})." }
  end
end
