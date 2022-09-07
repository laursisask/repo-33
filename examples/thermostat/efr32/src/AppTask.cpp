/*
 *
 *    Copyright (c) 2020 Project CHIP Authors
 *    Copyright (c) 2019 Google LLC.
 *    All rights reserved.
 *
 *    Licensed under the Apache License, Version 2.0 (the "License");
 *    you may not use this file except in compliance with the License.
 *    You may obtain a copy of the License at
 *
 *        http://www.apache.org/licenses/LICENSE-2.0
 *
 *    Unless required by applicable law or agreed to in writing, software
 *    distributed under the License is distributed on an "AS IS" BASIS,
 *    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *    See the License for the specific language governing permissions and
 *    limitations under the License.
 */

/**********************************************************
 * Includes
 *********************************************************/

#include "AppTask.h"
#include "AppConfig.h"
#include "AppEvent.h"
#include "LEDWidget.h"
#include "sl_simple_led_instances.h"

#ifdef DISPLAY_ENABLED
#include "lcd.h"
#ifdef QR_CODE_ENABLED
#include "qrcodegen.h"
#endif // QR_CODE_ENABLED
#endif // DISPLAY_ENABLED

#include <app-common/zap-generated/attribute-id.h>
#include <app-common/zap-generated/attribute-type.h>
#include <app-common/zap-generated/attributes/Accessors.h>
#include <app-common/zap-generated/callback.h>
#include <app-common/zap-generated/cluster-id.h>
#include <app-common/zap-generated/cluster-objects.h>
#include <app-common/zap-generated/command-id.h>
#include <app-common/zap-generated/enums.h>
#include <app-common/zap-generated/ids/Attributes.h>
#include <app/server/OnboardingCodesUtil.h>
#include <app/server/Server.h>
#include <app/util/attribute-storage.h>
#include <assert.h>
#include <lib/support/CodeUtils.h>
#include <platform/CHIPDeviceLayer.h>
#include <platform/EFR32/freertos_bluetooth.h>
#include <setup_payload/QRCodeSetupPayloadGenerator.h>
#include <setup_payload/SetupPayload.h>


/**********************************************************
 * Defines and Constants
 *********************************************************/

#define APP_FUNCTION_BUTTON &sl_button_btn0
#define APP_THERMOSTAT &sl_button_btn1

#define HEATING_MODE 1
#define COOLING_MODE 0

#define MODE_TIMER 1000
#define APP_FN_TIMER 500

#define MIN_HEATINGSETPOINT_LIMIT 700
#define MAX_HEATINGSETPOINT_LIMIT 3000
#define MIN_COOLINGSETPOINT_LIMIT 1600
#define MAX_COOLINGSETPOINT_LIMIT 3200

using namespace chip;
using namespace ::chip::DeviceLayer;


/**********************************************************
 * Variable declarations
 *********************************************************/

TimerHandle_t sModeTimer;
TimerHandle_t sAppFnTimer;

bool mModeTimerActive;
bool mAppFnTimerActive;

bool startModeTimerVar;
bool startAppFnTimerVar;

int thermostat_mode = HEATING_MODE;

int16_t heatingSetpoint = 0;
int16_t coolingSetpoint = 0;

AppTask::ThermoFunction_t btn1State;
AppTask::ThermoFunction_t btn0State;

AppEvent reset_button_event = {};

namespace {
EmberAfIdentifyEffectIdentifier sIdentifyEffect = EMBER_ZCL_IDENTIFY_EFFECT_IDENTIFIER_STOP_EFFECT;

}
/**********************************************************
 * Identify Callbacks
 *********************************************************/

namespace {
void OnTriggerIdentifyEffectCompleted(chip::System::Layer * systemLayer, void * appState)
{
    ChipLogProgress(Zcl, "Trigger Identify Complete");
    sIdentifyEffect = EMBER_ZCL_IDENTIFY_EFFECT_IDENTIFIER_STOP_EFFECT;

#if CHIP_DEVICE_CONFIG_ENABLE_SED == 1
    AppTask::GetAppTask().StopStatusLEDTimer();
#endif
}

void OnTriggerIdentifyEffect(Identify * identify)
{
    ChipLogProgress(Zcl, "Trigger Identify Effect");
    sIdentifyEffect = identify->mCurrentEffectIdentifier;

    if (identify->mCurrentEffectIdentifier == EMBER_ZCL_IDENTIFY_EFFECT_IDENTIFIER_CHANNEL_CHANGE)
    {
        ChipLogProgress(Zcl, "IDENTIFY_EFFECT_IDENTIFIER_CHANNEL_CHANGE - Not supported, use effect varriant %d",
                        identify->mEffectVariant);
        sIdentifyEffect = static_cast<EmberAfIdentifyEffectIdentifier>(identify->mEffectVariant);
    }

#if CHIP_DEVICE_CONFIG_ENABLE_SED == 1
    AppTask::GetAppTask().StartStatusLEDTimer();
#endif

    switch (sIdentifyEffect)
    {
    case EMBER_ZCL_IDENTIFY_EFFECT_IDENTIFIER_BLINK:
    case EMBER_ZCL_IDENTIFY_EFFECT_IDENTIFIER_BREATHE:
    case EMBER_ZCL_IDENTIFY_EFFECT_IDENTIFIER_OKAY:
        (void) chip::DeviceLayer::SystemLayer().StartTimer(chip::System::Clock::Seconds16(5), OnTriggerIdentifyEffectCompleted,
                                                           identify);
        break;
    case EMBER_ZCL_IDENTIFY_EFFECT_IDENTIFIER_FINISH_EFFECT:
        (void) chip::DeviceLayer::SystemLayer().CancelTimer(OnTriggerIdentifyEffectCompleted, identify);
        (void) chip::DeviceLayer::SystemLayer().StartTimer(chip::System::Clock::Seconds16(1), OnTriggerIdentifyEffectCompleted,
                                                           identify);
        break;
    case EMBER_ZCL_IDENTIFY_EFFECT_IDENTIFIER_STOP_EFFECT:
        (void) chip::DeviceLayer::SystemLayer().CancelTimer(OnTriggerIdentifyEffectCompleted, identify);
        sIdentifyEffect = EMBER_ZCL_IDENTIFY_EFFECT_IDENTIFIER_STOP_EFFECT;
        break;
    default:
        ChipLogProgress(Zcl, "No identifier effect");
    }
}

Identify gIdentify = {
    chip::EndpointId{ 1 },
    AppTask::GetAppTask().OnIdentifyStart,
    AppTask::GetAppTask().OnIdentifyStop,
    EMBER_ZCL_IDENTIFY_IDENTIFY_TYPE_VISIBLE_LED,
    OnTriggerIdentifyEffect,
};

} // namespace

using namespace chip::TLV;
using namespace ::chip::DeviceLayer;

/**********************************************************
 * AppTask Definitions
 *********************************************************/

AppTask AppTask::sAppTask;

CHIP_ERROR AppTask::Init()
{
    CHIP_ERROR err = CHIP_NO_ERROR;

    sModeTimer = xTimerCreate("ThermModeTmr",                   // Just a text name, not used by the RTOS kernel
                                  1,                            // == default timer period (mS)
                                  false,                        // no timer reload (==one-shot)
                                  (void *) this,                // init timer id = app task obj context
                                  ModeTimerEventHandler         // timer callback handler
    );
    if (sModeTimer == NULL)
    {
        EFR32_LOG("Creation of sModeTimer failed.");
        appError(APP_ERROR_CREATE_TIMER_FAILED);
    }

    sAppFnTimer = xTimerCreate("ThermFnTmr",                    // Just a text name, not used by the RTOS kernel
                                  1,                            // == default timer period (mS)
                                  false,                        // no timer reload (==one-shot)
                                  (void *) this,                // init timer id = app task obj context
                                  AppFnTimerEventHandler        // timer callback handler
    );
    if (sAppFnTimer == NULL)
    {
        EFR32_LOG("Creation of aAppFnTimer failed.");
        appError(APP_ERROR_CREATE_TIMER_FAILED);
    }

#ifdef DISPLAY_ENABLED
    GetLCD().Init((uint8_t *) "Thermostat-App");
#endif

    err = BaseApplication::Init(&gIdentify);
    if (err != CHIP_NO_ERROR)
    {
        EFR32_LOG("BaseApplication::Init() failed");
        appError(err);
    }

    return err;
}

CHIP_ERROR AppTask::StartAppTask()
{
    return BaseApplication::StartAppTask(AppTaskMain);
}

void AppTask::AppTaskMain(void * pvParameter)
{
    AppEvent event;
    QueueHandle_t sAppEventQueue = *(static_cast<QueueHandle_t *>(pvParameter));

    CHIP_ERROR err = sAppTask.Init();
    if (err != CHIP_NO_ERROR)
    {
        EFR32_LOG("AppTask.Init() failed");
        appError(err);
    }

#if !(defined(CHIP_DEVICE_CONFIG_ENABLE_SED) && CHIP_DEVICE_CONFIG_ENABLE_SED)
    sAppTask.StartStatusLEDTimer();
#endif

    EFR32_LOG("App Task started");
    while (true)
    {
        BaseType_t eventReceived = xQueueReceive(sAppEventQueue, &event, portMAX_DELAY);
        while (eventReceived == pdTRUE)
        {
            sAppTask.DispatchEvent(&event);
            eventReceived = xQueueReceive(sAppEventQueue, &event, 0);

            if(startModeTimerVar == true)
            {
                StartModeTimer(MODE_TIMER);
                startModeTimerVar = false;
            }
            if(startAppFnTimerVar == true)
            {
                StartAppFnTimer(APP_FN_TIMER);
                startAppFnTimerVar = false;
            }
            if ((mModeTimerActive == true) && (btn1State == kFunction_Temp))
            {
                CancelModeTimer();
                TemperatureHandler(&event);
                startModeTimerVar = false;
                btn1State = kFunction_Nothing;
            }
            if ((mAppFnTimerActive == true) && (btn0State == kFunction_Temp))
            {
                CancelAppFnTimer();
                TemperatureHandler(&event);
                startAppFnTimerVar = false;
                btn0State = kFunction_Nothing;
            }
        }
    }
}

void AppTask::OnIdentifyStart(Identify * identify)
{
    ChipLogProgress(Zcl, "onIdentifyStart");

#if CHIP_DEVICE_CONFIG_ENABLE_SED == 1
    sAppTask.StartStatusLEDTimer();
#endif
}

void AppTask::OnIdentifyStop(Identify * identify)
{
    ChipLogProgress(Zcl, "onIdentifyStop");

#if CHIP_DEVICE_CONFIG_ENABLE_SED == 1
    sAppTask.StopStatusLEDTimer();
#endif
}


void AppTask::CancelModeTimer()
{
    if (xTimerStop(sModeTimer, 0) == pdFAIL)
    {
        EFR32_LOG("thermostat mode timer stop() failed");
        appError(APP_ERROR_STOP_TIMER_FAILED);
    }
    mModeTimerActive = false;
}

void AppTask::StartModeTimer(uint32_t aTimeoutInMs)
{
    if (xTimerIsTimerActive(sModeTimer))
    {
        EFR32_LOG("mode timer already started!");
        CancelModeTimer();
    }

    if (xTimerChangePeriod(sModeTimer, aTimeoutInMs / portTICK_PERIOD_MS, 100) != pdPASS)
    {
        EFR32_LOG("mode timer start() failed");
        appError(APP_ERROR_START_TIMER_FAILED);
    }
    mModeTimerActive = true;
}


void AppTask::CancelAppFnTimer()
{
    if (xTimerStop(sAppFnTimer, 0) == pdFAIL) 
    {
        EFR32_LOG("thermostat AppFn timer stop() failed");
        appError(APP_ERROR_STOP_TIMER_FAILED);
    }
    mAppFnTimerActive = false;
}

void AppTask::StartAppFnTimer(uint32_t aTimeoutInMs)
{
    if (xTimerIsTimerActive(sAppFnTimer))
    {
        EFR32_LOG("thermostat AppFn timer already started!");
        CancelAppFnTimer();
    }
    if (xTimerChangePeriod(sAppFnTimer, aTimeoutInMs / portTICK_PERIOD_MS, 100) != pdPASS)
    {
        EFR32_LOG("thermostat AppFn timer start() failed");
        appError(APP_ERROR_START_TIMER_FAILED);
    }
    mAppFnTimerActive = true;
}


void AppTask::ModeTimerEventHandler(TimerHandle_t xTimer)
{
    AppEvent event;
    event.Type               = AppEvent::kEventType_Timer;
    event.TimerEvent.Context = (void *) xTimer;
    event.Handler            = ModeHandler;
    sAppTask.PostEvent(&event);
}

void AppTask::AppFnTimerEventHandler(TimerHandle_t xTimer)
{
    AppEvent event;
    event.Type               = AppEvent::kEventType_Timer;
    event.TimerEvent.Context = (void *) xTimer;
    event.Handler            = AppFnHandler;
    sAppTask.PostEvent(&event);
}


void AppTask::TemperatureHandler(AppEvent * aEvent)
{
    if (btn1State == kFunction_Temp)
    {
        CancelModeTimer();

        chip::EndpointId endpointId = 1; 

        if (thermostat_mode == HEATING_MODE)
        {
            int16_t maxHeatingSetpointLimit = MAX_HEATINGSETPOINT_LIMIT;

            chip::DeviceLayer::PlatformMgr().LockChipStack();
            chip::app::Clusters::Thermostat::Attributes::OccupiedHeatingSetpoint::Get(endpointId, &heatingSetpoint);
            chip::app::Clusters::Thermostat::Attributes::AbsMaxHeatSetpointLimit::Get(endpointId, &maxHeatingSetpointLimit);
            chip::DeviceLayer::PlatformMgr().UnlockChipStack();

            if (heatingSetpoint < maxHeatingSetpointLimit)
            {
                heatingSetpoint += 1;

                chip::DeviceLayer::PlatformMgr().LockChipStack();
                chip::app::Clusters::Thermostat::Attributes::OccupiedHeatingSetpoint::Set(endpointId, heatingSetpoint);
                chip::DeviceLayer::PlatformMgr().UnlockChipStack();
            }
            else
            {
                EFR32_LOG("No change: Maximum temperature limit reached.")
            }
        }
        else
        {
            int16_t maxCoolingSetpointLimit = MAX_COOLINGSETPOINT_LIMIT;

            chip::DeviceLayer::PlatformMgr().LockChipStack();
            chip::app::Clusters::Thermostat::Attributes::OccupiedCoolingSetpoint::Get(endpointId, &coolingSetpoint);
            chip::app::Clusters::Thermostat::Attributes::AbsMaxCoolSetpointLimit::Get(endpointId, &maxCoolingSetpointLimit);
            chip::DeviceLayer::PlatformMgr().UnlockChipStack();

            if (coolingSetpoint < maxCoolingSetpointLimit)
            {
                coolingSetpoint += 1;

                chip::DeviceLayer::PlatformMgr().LockChipStack();
                chip::app::Clusters::Thermostat::Attributes::OccupiedCoolingSetpoint::Set(endpointId, coolingSetpoint);
                chip::DeviceLayer::PlatformMgr().UnlockChipStack();
            }
            else
            {
                EFR32_LOG("No change: Maximum temperature limit reached.")
            }
        }
        btn1State = kFunction_Nothing;
        EFR32_LOG("Current temperature set to Heating: %d, Cooling: %d, with Mode: %d", heatingSetpoint, coolingSetpoint, thermostat_mode);
    }
    else if (btn0State == kFunction_Temp)
    {
        CancelAppFnTimer();

        chip::EndpointId endpointId = 1; 
        
        if (thermostat_mode == HEATING_MODE)
        {
            int16_t minHeatingSetpointLimit = MIN_HEATINGSETPOINT_LIMIT;

            chip::DeviceLayer::PlatformMgr().LockChipStack();
            chip::app::Clusters::Thermostat::Attributes::OccupiedHeatingSetpoint::Get(endpointId, &heatingSetpoint);
            chip::app::Clusters::Thermostat::Attributes::AbsMinHeatSetpointLimit::Get(endpointId, &minHeatingSetpointLimit);
            chip::DeviceLayer::PlatformMgr().UnlockChipStack();

            if (heatingSetpoint > minHeatingSetpointLimit)
            {
                heatingSetpoint -= 1;

                chip::DeviceLayer::PlatformMgr().LockChipStack();
                chip::app::Clusters::Thermostat::Attributes::OccupiedHeatingSetpoint::Set(endpointId, heatingSetpoint);
                chip::DeviceLayer::PlatformMgr().UnlockChipStack();
            }
            else
            {
                EFR32_LOG("No change: Minimum temperature limit reached.")
            }
        }
        else
        {
            int16_t minCoolingSetpointLimit = MIN_COOLINGSETPOINT_LIMIT;

            chip::DeviceLayer::PlatformMgr().LockChipStack();
            chip::app::Clusters::Thermostat::Attributes::OccupiedCoolingSetpoint::Get(endpointId, &coolingSetpoint);
            chip::app::Clusters::Thermostat::Attributes::AbsMinCoolSetpointLimit::Get(endpointId, &minCoolingSetpointLimit);
            chip::DeviceLayer::PlatformMgr().UnlockChipStack();

            if (coolingSetpoint > minCoolingSetpointLimit)
            {
                coolingSetpoint -= 1;

                chip::DeviceLayer::PlatformMgr().LockChipStack();
                chip::app::Clusters::Thermostat::Attributes::OccupiedCoolingSetpoint::Set(endpointId, coolingSetpoint);
                chip::DeviceLayer::PlatformMgr().UnlockChipStack();
            }
            else
            {
                EFR32_LOG("No change: Minimum temperature limit reached.")
            }
        }
        btn0State = kFunction_Nothing;
        EFR32_LOG("Current temperature set to Heating: %d, Cooling: %d, with Mode: %d", heatingSetpoint, coolingSetpoint, thermostat_mode);
    }
}


void AppTask::ModeHandler(AppEvent * aEvent)
{
    if (aEvent->Type != AppEvent::kEventType_Timer)
    {
        return;
    }

    if (thermostat_mode == HEATING_MODE)
    {
        thermostat_mode = COOLING_MODE;
    }
    else
    {
        thermostat_mode = HEATING_MODE;
    }
    EFR32_LOG("Thermostat Mode set to: %d, with current temperature Heating: %d, Cooling: %d", thermostat_mode, heatingSetpoint, coolingSetpoint);
    btn1State = kFunction_Nothing;
    CancelModeTimer();
}


void AppTask::AppFnHandler(AppEvent * aEvent)
{
    if (aEvent->Type != AppEvent::kEventType_Timer)
    {
        return;
    }
    EFR32_LOG("Initiating Factory Reset. Release button within %ums to stop.", APP_FN_TIMER);
    reset_button_event.Handler = BaseApplication::ButtonHandler;
    sAppTask.PostEvent(&reset_button_event);
    btn0State = kFunction_Nothing;
}


void AppTask::ButtonEventHandler(const sl_button_t * buttonHandle, uint8_t btnAction)
{
    if (buttonHandle == NULL)
    {
        return;
    }

    AppEvent button_event           = {};
    button_event.Type               = AppEvent::kEventType_Button;
    button_event.ButtonEvent.Action = btnAction;

    if (buttonHandle == APP_THERMOSTAT)
    {
        if (btnAction == SL_SIMPLE_BUTTON_PRESSED)
        {
            btn1State = kFunction_AppFn;
            startModeTimerVar = true;
            button_event.Handler = ModeHandler;
        }
        else
        {
            if (mModeTimerActive == true)
            {
                btn1State = kFunction_Temp;
            }
            else
            {
                btn1State = kFunction_Nothing;
            }
            startModeTimerVar = false;
            button_event.Handler = TemperatureHandler;
        }
        sAppTask.PostEvent(&button_event);
    }
    
    else if (buttonHandle == APP_FUNCTION_BUTTON)
    {
        if (btnAction)
        {
            reset_button_event.Type = AppEvent::kEventType_Button;
            reset_button_event.ButtonEvent.Action = btnAction;
            
            btn0State = kFunction_AppFn;
            startAppFnTimerVar = true;
            button_event.Handler = AppFnHandler;
            reset_button_event.Handler = AppFnHandler;
        }
        else
        {
            reset_button_event.ButtonEvent.Action = btnAction;
            
            if (mAppFnTimerActive == true)
            {
                btn0State = kFunction_Temp;
            }
            else
            {
                btn0State = kFunction_Nothing;
            }
            startAppFnTimerVar = false;
            button_event.Handler = TemperatureHandler;
        }
        sAppTask.PostEvent(&button_event);
        sAppTask.PostEvent(&reset_button_event);
    }
}