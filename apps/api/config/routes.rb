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

    # The admin surface (BLO-1047). Every member action is scoped to the token's group, so these
    # ids are always the caller's own house's; a cross-tenant id resolves to 404, never a leak.
    resource :group, only: %i[show update], controller: "group"
    resources :members, only: %i[index create update destroy] do
      post :rotate_link, on: :member
    end
    resources :rotas, only: %i[index show create update destroy] do
      resource :positions, only: :update, controller: "rota_positions"
      resources :shifts, only: :index
      post :preview_message, on: :member
    end
    resources :shifts, only: :update
    resources :sms_messages, only: :index
  end

  # Defines the root path route ("/")
  # root "posts#index"
end
