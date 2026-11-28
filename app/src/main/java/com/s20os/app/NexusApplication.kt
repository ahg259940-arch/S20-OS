package com.s20os.app

import android.app.Application

class NexusApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        NexusRuntime.initialize(this)
    }
}
