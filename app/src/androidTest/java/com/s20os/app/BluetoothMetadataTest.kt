package com.s20os.app

import android.bluetooth.BluetoothGattCharacteristic
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BluetoothMetadataTest {
    @Test fun propertyLabelsReflectOnlyAndroidGattFlags() {
        val properties = BluetoothGattCharacteristic.PROPERTY_READ or
            BluetoothGattCharacteristic.PROPERTY_WRITE or
            BluetoothGattCharacteristic.PROPERTY_NOTIFY
        assertEquals("leitura, escrita, notificações", BluetoothCentral.propertyNames(properties))
        assertEquals("sem propriedades comuns", BluetoothCentral.propertyNames(0))
    }

    @Test fun watchNameIsOnlyCandidateHeuristic() {
        assertTrue(BluetoothCentral.looksLikeLs7076("LS7076"))
        assertTrue(BluetoothCentral.looksLikeLs7076("S20 Ultra"))
        assertFalse(BluetoothCentral.looksLikeLs7076("Unknown"))
    }
}
