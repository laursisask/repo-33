module go.opentelemetry.io/contrib/instrumentation/github.com/labstack/echo

go 1.14

replace go.opentelemetry.io/contrib => ../../../..

require (
	github.com/labstack/echo/v4 v4.1.17
	github.com/stretchr/testify v1.9.0
	go.opentelemetry.io/contrib v0.11.0
	go.opentelemetry.io/otel v1.4.0
	go.opentelemetry.io/otel/exporters/stdout v0.11.0
	go.opentelemetry.io/otel/internal/metric v0.27.0 // indirect
	go.opentelemetry.io/otel/sdk v0.11.0
)
