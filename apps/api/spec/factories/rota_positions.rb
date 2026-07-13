FactoryBot.define do
  factory :rota_position do
    rota
    # A member of the rota's own group; RotaPosition rejects anything else.
    member { association :member, group: rota.group }
    sequence(:position)
  end
end
