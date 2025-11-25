package com.example.mobileappnav

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import com.example.mobileappnav.data.ClientRepository
import com.example.mobileappnav.databinding.ActivityMainBinding
import com.example.mobileappnav.model.Client
import com.example.mobileappnav.ui.ClientAdapter
import com.example.mobileappnav.ui.ClientDialogFragment

class MainActivity : AppCompatActivity(), ClientDialogFragment.Listener {

    private lateinit var binding: ActivityMainBinding
    private lateinit var adapter: ClientAdapter
    private val clients: MutableList<Client> by lazy { ClientRepository.loadClients(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ClientRepository.ensureLocalCopy(this)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupList()
    }

    private fun setupList() {
        adapter = ClientAdapter(clients) { client, position ->
            ClientDialogFragment.newInstance(client, position)
                .show(supportFragmentManager, "client_dialog")
        }
        binding.clientsRecyclerView.layoutManager = LinearLayoutManager(this)
        binding.clientsRecyclerView.adapter = adapter
    }

    override fun onClientUpdated(updated: Client, position: Int) {
        if (position in clients.indices) {
            clients[position] = updated
            adapter.updateClient(position, updated)
            ClientRepository.saveClients(this, clients)
        }
    }
}
