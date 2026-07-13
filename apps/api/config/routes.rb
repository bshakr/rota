Rails.application.routes.draw do
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  # Twilio's delivery receipts. Unauthenticated by design and signature-validated instead — see
  # Webhooks::TwilioStatusController.
  post "webhooks/twilio/status" => "webhooks/twilio_status#create", as: :twilio_status_webhook

  # The admin API. Everything under it inherits Api::BaseController, so every route here is
  # authenticated by a WorkOS-signed JWT and scoped to the group that token names.
  namespace :api do
    get "me", to: "me#show"
  end

  # Defines the root path route ("/")
  # root "posts#index"
end
