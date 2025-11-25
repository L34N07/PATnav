package com.example.mobileappnav.model

import com.google.gson.annotations.SerializedName
import java.io.Serializable

data class Client(
    val name: String,
    var x10: Int = 0,
    var x20: Int = 0,
    @SerializedName("10L") var tenLiters: Int = 0,
    @SerializedName("20L") var twentyLiters: Int = 0
) : Serializable
