Rails.application.routes.draw do
  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  namespace :public do
    get "households/:slug", to: "households#show"
    post "households/:slug/request_link", to: "households#request_link"
  end

  # Twilio's delivery receipts. Unauthenticated by design and signature-validated instead — see
  # Webhooks::TwilioStatusController.
  post "webhooks/twilio/status" => "webhooks/twilio_status#create", as: :twilio_status_webhook

  # The web app's own events (wave 4c). Server-to-server from Next, authenticated by a shared secret
  # rather than a token, and deliberately outside the `api` namespace: there is no WorkOS identity
  # here and no tenant to scope to. It accepts only the four anonymous event names — see
  # Internal::AnalyticsEventsController for why that list is not every name.
  namespace :internal do
    post "analytics/events", to: "analytics_events#create"
  end

  # The admin API. Everything under it inherits Api::BaseController — so every route here is
  # authenticated by a WorkOS-signed JWT and scoped to the group that token names — with one
  # deliberate exception, marked below.
  namespace :api do
    get "me", to: "me#show"

    # The exception (BLO-1671). Api::SignInsController inherits ApplicationController, not
    # Api::BaseController: it verifies the same token but accepts one that names no organization,
    # because "signed in, has no house yet" is exactly the funnel step it exists to record. It is
    # not tenant-scoped, provisions no group, and can write nothing but the caller's own rows.
    post "sign_ins", to: "sign_ins#create"

    # The admin surface (BLO-1047). Every member action is scoped to the token's group, so these
    # ids are always the caller's own house's; a cross-tenant id resolves to 404, never a leak.
    resource :group, only: %i[show update], controller: "group" do
      # The house calendar link (BLO-1667). Singular, like the group: there is one per house and the
      # token names it, so no id ever appears in these paths, and the link itself is a credential
      # that must never become one.
      resource :calendar, only: %i[update destroy], controller: "group_calendar" do
        post :sync
        get :events
      end
    end
    resources :members, only: %i[index create update destroy] do
      post :rotate_link, on: :member
    end
    resources :rotas, only: %i[index show create update destroy] do
      resource :positions, only: :update, controller: "rota_positions"
      resources :shifts, only: :index
      post :preview_message, on: :member
    end
    # `index` is the WHOLE house's upcoming turns in one request, which is what the dashboard reads
    # (BLO-1697). The nested `resources :shifts, only: :index` above stays exactly as it was: the
    # rota screen still asks per rota, and the two share one controller action.
    resources :shifts, only: %i[index update]
    resources :sms_messages, only: :index

    # The member magic-link path (BLO-1048). A SECOND, deliberately narrow way in: no WorkOS identity,
    # authenticated by an opaque bearer token that maps to one member (MemberAuthenticatable), and able
    # to reach only that member's own shifts and the cover action. The token is NEVER a path segment —
    # `/s/:token` exists only as the Next.js page, which forwards the token as a bearer header.

    # The whole house's upcoming rota (BLO-1666). Additive: /api/member/shifts stays as it is until
    # nothing calls it. Like every member route, the token is a bearer header and never a path part.
    get    "member/schedule",         to: "member_schedules#show"
    get    "member/shifts",           to: "member_shifts#index"
    post   "member/shifts/:id/cover", to: "member_covers#create"
    delete "member/shifts/:id/cover", to: "member_covers#destroy"
  end

  # The operator API (BLO-1669). Mounted under /api/super_admin, but deliberately OUTSIDE the `api`
  # namespace above: these are SuperAdmin::* controllers inheriting SuperAdmin::BaseController, not
  # Api::BaseController, so nothing here is TenantScoped and everything here is gated on the
  # SUPER_ADMIN_WORKOS_USER_IDS allowlist instead. Later tickets hang groups, traffic and spend off
  # this same block; spec/requests/super_admin/authorization_spec.rb walks whatever is in it and
  # asserts every route answers 404 to a caller who is not on the allowlist.
  namespace :super_admin, path: "api/super_admin" do
    get "overview", to: "overview#show"

    # Group management (BLO-1674). Ids here are deliberately NOT the caller's own house's — reading
    # across every tenant is the whole point of this namespace, and the allowlist, not a scope, is
    # what stands in front of it. The nested log is the house's own delivery log with the magic
    # link redacted out of every body.
    resources :groups, only: %i[index show update] do
      resources :sms_messages, only: :index

      # Suspend and resume (BLO-1675). A singular resource rather than two member actions on the
      # group, and its own controller, because "is this house paused" is one piece of state with one
      # way in and one way out: POST sets it, DELETE clears it, and both are idempotent. Keeping it
      # off SuperAdmin::GroupsController also keeps the controller that reads every house in the
      # database separate from the one that writes to them.
      resource :suspension, only: %i[create destroy], path: "suspend", controller: "suspensions"
    end

    # ?range=30d|90d|12m, and optional — a bare GET answers for the last 30 days, which is also what
    # lets the authorization walker above request this route with no parameters (BLO-1683).
    get "spend", to: "spend#show"

    # Conversion and usage (BLO-1681). ?range=7d|30d|90d, and optional — a bare GET answers for the
    # last 30 days, which is also what lets the authorization walker above request this route with
    # no parameters.
    get "traffic", to: "traffic#show"
  end

  # Defines the root path route ("/")
  # root "posts#index"
end
