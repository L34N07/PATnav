package com.example.mobileappnav.ui

import android.app.Dialog
import android.os.Bundle
import androidx.fragment.app.DialogFragment
import androidx.core.os.bundleOf
import com.example.mobileappnav.databinding.DialogClientBinding
import com.example.mobileappnav.model.Client
import com.google.android.material.dialog.MaterialAlertDialogBuilder

class ClientDialogFragment : DialogFragment() {

    interface Listener {
        fun onClientUpdated(updated: Client, position: Int)
    }

    private var listener: Listener? = null
    private var client: Client? = null
    private var position: Int = -1

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        listener = activity as? Listener
        arguments?.let { args ->
            client = args.getSerializable(ARG_CLIENT) as? Client
            position = args.getInt(ARG_POSITION)
        }
    }

    override fun onCreateDialog(savedInstanceState: Bundle?): Dialog {
        val binding = DialogClientBinding.inflate(layoutInflater)
        val currentClient = client ?: error("Client missing")

        binding.dialogTitle.text = currentClient.name

        var x10 = currentClient.x10
        var x20 = currentClient.x20
        var tenL = currentClient.tenLiters
        var twentyL = currentClient.twentyLiters

        fun updateViews() {
            binding.valueX10.text = x10.toString()
            binding.valueX20.text = x20.toString()
            binding.value10L.text = tenL.toString()
            binding.value20L.text = twentyL.toString()
        }

        fun increment(value: Int) = value + 1
        fun decrement(value: Int) = if (value > 0) value - 1 else 0

        binding.plusX10.setOnClickListener { x10 = increment(x10); updateViews() }
        binding.minusX10.setOnClickListener { x10 = decrement(x10); updateViews() }

        binding.plusX20.setOnClickListener { x20 = increment(x20); updateViews() }
        binding.minusX20.setOnClickListener { x20 = decrement(x20); updateViews() }

        binding.plus10L.setOnClickListener { tenL = increment(tenL); updateViews() }
        binding.minus10L.setOnClickListener { tenL = decrement(tenL); updateViews() }

        binding.plus20L.setOnClickListener { twentyL = increment(twentyL); updateViews() }
        binding.minus20L.setOnClickListener { twentyL = decrement(twentyL); updateViews() }

        updateViews()

        binding.cancelButton.setOnClickListener { dismiss() }
        binding.confirmButton.setOnClickListener {
            val updated = currentClient.copy(
                x10 = x10,
                x20 = x20,
                tenLiters = tenL,
                twentyLiters = twentyL
            )
            listener?.onClientUpdated(updated, position)
            dismiss()
        }

        return MaterialAlertDialogBuilder(requireContext())
            .setView(binding.root)
            .create()
    }

    companion object {
        private const val ARG_CLIENT = "arg_client"
        private const val ARG_POSITION = "arg_position"

        fun newInstance(client: Client, position: Int): ClientDialogFragment {
            return ClientDialogFragment().apply {
                arguments = bundleOf(
                    ARG_CLIENT to client,
                    ARG_POSITION to position
                )
            }
        }
    }
}
