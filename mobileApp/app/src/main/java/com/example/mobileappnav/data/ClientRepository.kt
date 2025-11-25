package com.example.mobileappnav.data

import android.content.Context
import com.example.mobileappnav.model.Client
import com.example.mobileappnav.model.ClientList
import com.google.gson.Gson
import com.google.gson.JsonSyntaxException
import java.io.File
import java.io.IOException

object ClientRepository {
    private const val FILE_NAME = "clients.json"
    private val gson = Gson()

    fun ensureLocalCopy(context: Context) {
        val target = File(context.filesDir, FILE_NAME)
        if (target.exists()) return

        try {
            context.assets.open(FILE_NAME).use { input ->
                target.outputStream().use { output ->
                    input.copyTo(output)
                }
            }
        } catch (_: IOException) {
            // If assets can't be read we leave the file absent; callers will get an empty list.
        }
    }

    fun loadClients(context: Context): MutableList<Client> {
        ensureLocalCopy(context)
        val file = File(context.filesDir, FILE_NAME)
        if (!file.exists()) return mutableListOf()

        return try {
            val json = file.readText()
            val clientList = gson.fromJson(json, ClientList::class.java)
            clientList?.clients ?: mutableListOf()
        } catch (_: IOException) {
            mutableListOf()
        } catch (_: JsonSyntaxException) {
            mutableListOf()
        }
    }

    fun saveClients(context: Context, clients: List<Client>) {
        val file = File(context.filesDir, FILE_NAME)
        val json = gson.toJson(ClientList(clients.toMutableList()))
        file.writeText(json)
    }
}
